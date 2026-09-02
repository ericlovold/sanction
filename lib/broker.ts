// BROKER-1: the hosted MCP broker — Sanction fronts another MCP server and
// INTERCEPTS tools/call through the same tool-authorization shell the REST
// route uses, the way the LLM gateway already intercepts inference. This is
// the slice that makes "a hijacked agent cannot spend" true for MCP traffic
// that flows through the broker: the host configures the broker URL instead
// of the upstream, holds only its Sanction agent key, and the wallet carries
// the upstream credential.
//
// Two security invariants, load-bearing:
//   1. Outbound upstream headers are BUILT FRESH, never copied from the
//      inbound request — the agent's Sanction key must never reach an
//      upstream server.
//   2. The upstream credential is decrypted server-side from the wallet's
//      SEC-1 vault (label `mcp:<name>`, same reserved-label pattern as
//      `provider:<id>`) and injected into the configured header. The agent
//      never sees it in any response, including errors.

import { z } from "zod"
import { decryptCredentialEnvelope } from "@/lib/credentialCrypto"
import { isPublicHttpsUrl } from "@/lib/webhooks"
import { withTenant } from "@/lib/rls"

export const UPSTREAM_LABEL_PREFIX = "mcp:"
export const UPSTREAM_NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/

// What the vault row's encrypted JSON carries.
export const upstreamConfigSchema = z.object({
  url: z.string().min(1),
  // Optional auth the upstream expects; injected server-side on every forward.
  auth_header: z.string().trim().min(1).max(64).optional(),
  auth_value: z.string().min(1).max(4096).optional(),
})
export type UpstreamConfig = z.infer<typeof upstreamConfigSchema>

export function validateUpstreamRegistration(name: string, config: UpstreamConfig): string | null {
  if (!UPSTREAM_NAME_RE.test(name)) {
    return "name must be 1-40 chars of lowercase letters, digits, or hyphens (starting alphanumeric)"
  }
  if (!isPublicHttpsUrl(config.url)) return "url must be a public https:// URL"
  if ((config.auth_header == null) !== (config.auth_value == null)) {
    return "auth_header and auth_value must be provided together"
  }
  return null
}

/** Load a wallet's registered upstream. Returns null when unregistered. */
export async function loadUpstream(walletId: string, name: string): Promise<UpstreamConfig | null> {
  if (!UPSTREAM_NAME_RE.test(name)) return null
  // SEC-3: CredentialVault is FORCE ROW LEVEL SECURITY — reads outside the
  // tenant context return nothing, even for the table owner. Every reserved-
  // label read must run inside withTenant.
  const row = await withTenant(walletId, (tx) =>
    tx.credentialVault.findFirst({
      where: { walletId, label: `${UPSTREAM_LABEL_PREFIX}${name}`, revokedAt: null },
    }),
  )
  if (!row) return null
  const raw = await decryptCredentialEnvelope(row)
  const parsed = upstreamConfigSchema.safeParse(JSON.parse(raw))
  return parsed.success ? parsed.data : null
}

// ── JSON-RPC classification ──────────────────────────────────────────────────

type JsonRpcMessage = {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: {
    name?: string
    arguments?: Record<string, unknown>
    _meta?: Record<string, unknown>
  }
}

export type BrokerCall =
  | { kind: "tools_call"; id: string | number | null; tool: string; args?: Record<string, unknown>; grantId?: string }
  | { kind: "passthrough" }
  | { kind: "invalid"; reason: string }

/** The _meta key an agent uses to redeem an approval through the broker. */
export const GRANT_META_KEY = "sanction/grant_id"

/**
 * Classify one JSON-RPC message. Batches are passed through untouched only
 * when they contain no tools/call — a batched tools/call is refused rather
 * than silently forwarded around the ladder (fail closed, never around).
 */
export function classifyBrokerBody(body: unknown): BrokerCall {
  if (Array.isArray(body)) {
    const hasToolsCall = body.some((m) => (m as JsonRpcMessage)?.method === "tools/call")
    return hasToolsCall
      ? { kind: "invalid", reason: "Batched tools/call is not supported through the broker; send it as a single request" }
      : { kind: "passthrough" }
  }
  const msg = body as JsonRpcMessage
  if (!msg || typeof msg !== "object" || msg.method !== "tools/call") return { kind: "passthrough" }
  const tool = msg.params?.name
  if (typeof tool !== "string" || tool.length === 0) {
    return { kind: "invalid", reason: "tools/call requires params.name" }
  }
  const rawGrant = msg.params?._meta?.[GRANT_META_KEY]
  return {
    kind: "tools_call",
    id: msg.id ?? null,
    tool,
    args: msg.params?.arguments,
    grantId: typeof rawGrant === "string" && rawGrant.length > 0 ? rawGrant : undefined,
  }
}

// ── Refusal shaping (MCP semantics: a refused tool call is a RESULT with
// isError, not a protocol error — hosts hand it to the model to react to) ───

export function brokerRefusalResult(
  id: string | number | null,
  decision: { status: string; code?: string; reason?: string; remediation?: string; request_id?: string },
): Record<string, unknown> {
  const text =
    decision.status === "escalated"
      ? `✗ ESCALATED — ${decision.reason ?? "Awaiting human approval"}. Request id: ${decision.request_id ?? "(see the record)"}. When the owner approves, retry this exact tools/call with _meta[\"${GRANT_META_KEY}\"] set to the grant_id (poll sanction_check_authorization, or GET /v1/authorize/{request_id}).`
      : `✗ DENIED${decision.code ? ` (${decision.code})` : ""} — ${decision.reason ?? "Not authorized"}.${decision.remediation ? ` ${decision.remediation}` : ""}`
  return {
    jsonrpc: "2.0",
    id,
    result: { content: [{ type: "text", text }], isError: true },
  }
}

// ── Forwarding ───────────────────────────────────────────────────────────────

const UPSTREAM_TIMEOUT_MS = 25_000

/**
 * Forward a request body to the upstream. Headers are constructed from
 * scratch (invariant 1); the vaulted auth header is injected (invariant 2);
 * MCP session/protocol headers pass through by allow-list because stateful
 * upstreams need them.
 */
export async function forwardToUpstream(
  upstream: UpstreamConfig,
  inbound: { method: string; headers: Headers; rawBody: string | undefined },
): Promise<Response> {
  const headers = new Headers({ accept: "application/json, text/event-stream" })
  if (inbound.rawBody !== undefined) headers.set("content-type", "application/json")
  for (const h of ["mcp-session-id", "mcp-protocol-version", "last-event-id"]) {
    const v = inbound.headers.get(h)
    if (v) headers.set(h, v)
  }
  if (upstream.auth_header && upstream.auth_value) headers.set(upstream.auth_header, upstream.auth_value)
  // The upstream URL was validated as public https when it was registered. A
  // redirect issued later could send this server-side fetch — carrying the
  // vaulted auth header — to loopback, a private range, or a metadata endpoint.
  // Never follow one: a 3xx is answered as a broker refusal (invariant 3).
  const res = await fetch(upstream.url, {
    method: inbound.method,
    headers,
    body: inbound.rawBody,
    redirect: "manual",
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  })
  if (res.status >= 300 && res.status < 400) {
    return new Response(
      JSON.stringify({ error: "upstream_redirect", message: "The upstream answered with a redirect; the broker does not follow redirects. Re-register the upstream at its final URL." }),
      { status: 502, headers: { "content-type": "application/json" } },
    )
  }
  return res
}
