import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { frozenNote, walletFreezeState } from "@/lib/freeze"
import { hashApiKey } from "@/lib/apiKey"
import { GATEWAY_PROVIDERS, isBudgetExhausted, isMeteredPath, meterUsage, makeStreamMeter, forceStreamUsage } from "@/lib/gateway"
import type { GatewayUsage } from "@/lib/gateway"
import { hasProviderAuth, providerAuthHeader, type ProviderId } from "@/lib/providers"
import { decryptCredentialEnvelope } from "@/lib/credentialCrypto"
import { withTenant } from "@/lib/rls"
import { notifyTokenBudgetThreshold } from "@/lib/thresholds"
import { logger } from "@/lib/log"

export const dynamic = "force-dynamic"
// Streaming responses relay at the provider's pace; give long generations room
// so a live stream is never cut mid-flight (the old buffered path could burn
// tokens then time out at 60s with nothing delivered).
export const maxDuration = 300

const log = logger("gateway")

// Headers we must not forward upstream (Sanction auth and dashboard session,
// hop-by-hop, encoding, and our edge's client-IP / platform headers). The
// caller's own provider auth (authorization, x-api-key, x-goog-api-key) is
// deliberately forwarded — it is how bring-your-own-key works.
const STRIP_REQ = new Set([
  "host", "x-sanction-key", "x-mgmt-key", "cookie", "content-length", "accept-encoding", "connection",
  "forwarded", "x-real-ip",
])
const STRIP_REQ_PREFIXES = ["x-forwarded-", "x-vercel-"]
// Response headers we re-derive (body was decoded by fetch), plus upstream
// cookies, which must never be set on Sanction's origin.
const STRIP_RES = new Set(["content-encoding", "content-length", "transfer-encoding", "connection", "set-cookie"])

async function authAgent(req: NextRequest) {
  const key = req.headers.get("x-sanction-key")
  if (!key) return null
  const agent = await db.agent.findUnique({
    where: { apiKeyHash: hashApiKey(key) },
    include: { wallet: { include: { policy: true } } },
  })
  if (!agent || !agent.isActive) return null
  // Seat expiry fails closed on the gateway too - same rule as lib/auth.ts.
  if (agent.expiresAt && agent.expiresAt <= new Date()) return null
  return agent
}

function upstreamHeaders(req: NextRequest): Headers {
  const h = new Headers()
  req.headers.forEach((v, k) => {
    const name = k.toLowerCase()
    if (STRIP_REQ.has(name) || STRIP_REQ_PREFIXES.some((p) => name.startsWith(p))) return
    h.set(k, v)
  })
  return h
}

function passthroughResponse(upstream: Response, body: BodyInit | null): Response {
  const h = new Headers()
  upstream.headers.forEach((v, k) => {
    if (!STRIP_RES.has(k.toLowerCase())) h.set(k, v)
  })
  // Proxied LLM responses are per-request and must never be cached at the edge.
  h.set("cache-control", "no-store")
  return new Response(body, { status: upstream.status, headers: h })
}

function meteringFailure(): Response {
  return NextResponse.json(
    { error: "Sanction metering failed; provider response withheld" },
    { status: 502, headers: { "cache-control": "no-store" } },
  )
}

async function handle(req: NextRequest, ctx: { params: Promise<{ provider: string; path?: string[] }> }) {
  const { provider, path = [] } = await ctx.params
  const noStore = { "cache-control": "no-store" }
  const cfg = Object.hasOwn(GATEWAY_PROVIDERS, provider) ? GATEWAY_PROVIDERS[provider] : undefined
  if (!cfg) return NextResponse.json({ error: `Unknown gateway provider '${provider}'` }, { status: 404, headers: noStore })

  const agent = await authAgent(req)
  if (!agent) return NextResponse.json({ error: "Missing or invalid x-sanction-key" }, { status: 401, headers: noStore })

  // KILL-1: a frozen wallet (or ancestor) pauses the gateway too — metered LLM
  // calls are spend.
  const freeze = await walletFreezeState(db, agent.walletId)
  if (freeze.frozen) {
    return NextResponse.json({ error: frozenNote(freeze), code: "WALLET_FROZEN" }, { status: 403, headers: noStore })
  }

  // Token budget wall before the call: seat daily, seat monthly, then pooled
  // subtree caps up the wallet tree — if any line is spent, don't call out.
  const { exhausted, spent, budget, horizon, capWalletId } = await isBudgetExhausted(agent)
  if (exhausted) {
    const which = horizon ?? "daily"
    const label =
      which === "subtree-daily"
        ? "Pool daily token cap exhausted"
        : which === "monthly"
          ? "Monthly token budget exhausted"
          : "Daily token budget exhausted"
    return NextResponse.json(
      {
        error: label,
        horizon: which,
        limit_usd: budget,
        spent_usd: spent,
        // Back-compat fields for existing integrations (daily wall shape).
        daily_limit_usd: which === "daily" ? budget : undefined,
        daily_spent_usd: which === "daily" ? spent : undefined,
        cap_wallet_id: capWalletId,
      },
      { status: 402, headers: noStore },
    )
  }

  const url = `${cfg.baseUrl}/${path.join("/")}${req.nextUrl.search}`
  const method = req.method
  const rawBody = method === "GET" || method === "HEAD" ? undefined : await req.arrayBuffer()
  // Metering is not the caller's choice: force stream usage reporting on the
  // way out (no-op for providers that already stream usage by default).
  const body = forceStreamUsage(provider, rawBody)

  // Provider-key injection (Providers page): when the caller sends NO provider
  // auth of its own, fall back to the wallet's vaulted provider:<id> key —
  // decrypted server-side, injected into the right header, never returned to
  // the caller. Callers that bring their own auth are untouched. No vaulted
  // key either → fail closed with a pointer, before any upstream call.
  const outHeaders = upstreamHeaders(req)
  if (!hasProviderAuth(outHeaders)) {
    // The stored key only goes to endpoints we meter; anything else would
    // spend on the wallet's key invisibly.
    if (!isMeteredPath(provider, method, path.join("/"))) {
      return NextResponse.json(
        {
          error: `The stored ${provider} key is only used for metered endpoints; ${method} /${path.join("/")} is not one. Send your own provider auth header to call it directly.`,
          code: "GATEWAY_PATH_NOT_METERED",
        },
        { status: 403, headers: noStore },
      )
    }
    const providerId = provider as ProviderId
    // SEC-3: CredentialVault is FORCE RLS — this read silently returned null
    // outside the tenant context, so a connected provider still answered
    // PROVIDER_NOT_CONNECTED. Found by the broker arc's live fire.
    const cred = await withTenant(agent.walletId, (tx) =>
      tx.credentialVault.findFirst({
        where: { walletId: agent.walletId, label: `provider:${providerId}`, revokedAt: null },
      }),
    )
    if (!cred) {
      return NextResponse.json(
        {
          error: `No ${provider} credential: send your own auth header, or connect ${provider} once under Dashboard → Providers`,
          code: "PROVIDER_NOT_CONNECTED",
        },
        { status: 401, headers: noStore },
      )
    }
    try {
      const key = await decryptCredentialEnvelope(cred)
      const h = providerAuthHeader(providerId, key)
      outHeaders.set(h.name, h.value)
    } catch {
      return NextResponse.json(
        { error: `Stored ${provider} credential could not be decrypted; reconnect it under Dashboard → Providers`, code: "PROVIDER_KEY_UNREADABLE" },
        { status: 502, headers: noStore },
      )
    }
  }
  const notifyThreshold = async (cost: number) => {
    try {
      await notifyTokenBudgetThreshold({
        walletId: agent.walletId,
        agentId: agent.id,
        ownerEmail: agent.wallet.ownerEmail,
        agentName: agent.name,
        prevUsd: spent,
        nextUsd: spent + cost,
        budgetUsd: budget,
      })
    } catch {
      // Threshold alerts are best-effort; the usage write above is not.
    }
  }
  const meterObservedUsage = async (usage: GatewayUsage): Promise<boolean> => {
    try {
      const cost = await meterUsage(agent.id, provider, usage)
      await notifyThreshold(cost)
      return true
    } catch {
      return false
    }
  }
  // Meter with bounded retries — for the streaming path, where the client has
  // already received the bytes so we can't withhold. The budget gate above
  // already fails closed on a DB outage (the read throws before the provider
  // is ever called), so the only case this covers is a transient write blip
  // after a healthy read. Retries clear that; a hard final failure is logged
  // loudly (a genuine anomaly) and left as a single-call under-count — the
  // honest limit without an external durable queue.
  const meterWithRetry = async (usage: GatewayUsage): Promise<void> => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (await meterObservedUsage(usage)) return
    }
    console.error("gateway meter write failed after retries — usage uncounted", {
      agentId: agent.id, provider, tokensIn: usage.tokensIn, tokensOut: usage.tokensOut,
    })
  }

  let upstream: Response
  try {
    upstream = await fetch(url, { method, headers: outHeaders, body })
  } catch {
    return NextResponse.json({ error: "Upstream provider unreachable" }, { status: 502, headers: noStore })
  }

  const ct = upstream.headers.get("content-type") ?? ""

  // Streaming (SSE) → tee bytes straight through to the client as the provider
  // produces them, parse `data:` events as they pass, and meter the accumulated
  // usage when the stream ends. Live streaming is preserved; metering settles at
  // stream-end with retries. (Withholding a stream we've already begun sending
  // is impossible, and buffering the whole thing first kills streaming and risks
  // a token-burn-then-timeout at maxDuration — that's why the enforcement leans
  // on the pre-call budget gate, which fails closed on a DB outage.)
  //
  // The stream can also end without draining: the client disconnects, the
  // upstream errors, or the runtime cancels us. Tokens the provider already
  // reported (Anthropic's input side lands in message_start) are real spend,
  // so every exit path settles whatever usage has accumulated — exactly once.
  if (ct.includes("text/event-stream") && upstream.body) {
    const meter = makeStreamMeter(provider)
    const decoder = new TextDecoder()
    const reader = upstream.body.getReader()
    let buf = ""
    let settled = false
    const parse = (chunk: Uint8Array) => {
      buf += decoder.decode(chunk, { stream: true })
      let nl: number
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (line.startsWith("data:")) {
          const payload = line.slice(5).trim()
          if (payload && payload !== "[DONE]") {
            try {
              meter.feed(JSON.parse(payload))
            } catch {
              // partial/non-JSON event line — ignore
            }
          }
        }
      }
    }
    const settle = async (outcome: "complete" | "cancelled" | "upstream-error") => {
      if (settled) return
      settled = true
      const usage = meter.result()
      if (usage.tokensIn || usage.tokensOut) {
        await meterWithRetry(usage)
      } else {
        // No usage seen: either the stream reported none even after we set
        // include_usage, or it ended before the provider sent any (OpenAI
        // only reports at the end). The call is unmetered and the budget did
        // not move. Never silent: an unmetered call is a hole in the thing
        // this product exists to guarantee.
        log.warn("gateway stream reported no usage — call is unmetered", {
          provider,
          agentId: agent.id,
          walletId: agent.walletId,
          path: path.join("/"),
          outcome,
        })
      }
    }
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        let next: ReadableStreamReadResult<Uint8Array>
        try {
          next = await reader.read()
        } catch (err) {
          await settle("upstream-error")
          controller.error(err)
          return
        }
        if (next.done) {
          await settle("complete")
          controller.close()
          return
        }
        controller.enqueue(next.value) // live pass-through — the client sees every token as it lands
        parse(next.value)
      },
      async cancel(reason) {
        // Stop the provider generating first, then bill what it already reported.
        await reader.cancel(reason).catch(() => {})
        await settle("cancelled")
      },
    })
    return passthroughResponse(upstream, stream)
  }

  // JSON response -> read, meter, return.
  if (ct.includes("application/json")) {
    const buf = await upstream.arrayBuffer()
    let usage: GatewayUsage | null = null
    try {
      const json = JSON.parse(new TextDecoder().decode(buf))
      usage = cfg.extract(json, path.join("/"))
    } catch {
      // not parseable / no usage - pass the body through untouched
    }
    if (usage && (usage.tokensIn || usage.tokensOut) && !(await meterObservedUsage(usage))) {
      return meteringFailure()
    }
    return passthroughResponse(upstream, buf)
  }

  return passthroughResponse(upstream, upstream.body)
}

// Next detects route methods by static named-export analysis; declaring them as
// functions (not `export const POST = handle`) is required for the route to register.
export async function POST(req: NextRequest, ctx: { params: Promise<{ provider: string; path?: string[] }> }) {
  return handle(req, ctx)
}
export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string; path?: string[] }> }) {
  return handle(req, ctx)
}
