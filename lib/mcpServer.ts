/**
 * Sanction MCP wallet — tool surface shared by stdio (`mcp-server.ts`) and the
 * hosted Streamable HTTP endpoint (`app/mcp/route.ts`). Cooperative: the host
 * must ask before acting. Discovery: GET /.well-known/wallet-card.json
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { renderDecisionResult } from "./mcpDecisionResult"
import { renderWalletStatus } from "./mcpWalletStatus"
import { extractTraceContext, traceHeaders, type TraceContext } from "./traceContext"

export type SanctionMcpToolProfile = "wallet" | "approvals"

// Explicit allowlist: new wallet tools require a separate review before exposure.
export const APPROVAL_MCP_TOOLS: readonly string[] = [
  "sanction_authorize",
  "sanction_authorize_provision",
  "sanction_authorize_tool",
  "sanction_authorize_capability",
  "sanction_log_tokens",
  "sanction_log_outcome",
  "sanction_wallet_status",
  "sanction_check_authorization",
]

export type SanctionMcpApiCall = (
  path: string, method: "GET" | "POST", body?: unknown, bearerToken?: string, trace?: TraceContext,
) => Promise<Record<string, unknown>>

export type SanctionMcpOptions = {
  apiKey: string
  apiUrl: string
  walletId?: string
  apiCall?: SanctionMcpApiCall
  toolProfile?: SanctionMcpToolProfile
}

export const MCP_SERVER_VERSION = "0.10.0"

// MCP 2026-07-28 reserves `traceparent`/`tracestate`/`baggage` in `_meta` for
// W3C trace context, replacing deprecated protocol Logging as the sanctioned
// observability path. Every tool handler pulls them off its own request — the
// protocol is stateless, so trace context is per-request input, never
// connection state (spec § Statelessness, which binds stdio too).
const traceOf = (extra: { _meta?: unknown } | undefined): TraceContext => extractTraceContext(extra?._meta)

async function callSanction(
  opts: SanctionMcpOptions,
  path: string,
  method: "GET" | "POST",
  body?: unknown,
  bearerToken?: string,
  trace: TraceContext = {},
) {
  // x-api-key identifies the agent on every call; a Bearer token (execution JWT)
  // is additive — used by inject and to enforce an execution's spend cap.
  // Trace headers are diagnostic only and never participate in authorization.
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": opts.apiKey,
    ...traceHeaders(trace),
  }
  if (bearerToken) {
    headers["Authorization"] = `Bearer ${bearerToken}`
  }
  // Transport failures must degrade to a clear deny, not an opaque JS error:
  // this tool fronts real money decisions, and an ambiguous failure invites
  // agents to retry-loop or (worse) proceed. Normalize network errors,
  // timeouts, and non-JSON bodies (gateway 502 pages) into the same
  // { authorized:false, code, reason } contract every tool description promises.
  try {
    if (opts.apiCall) return await opts.apiCall(path, method, body, bearerToken, trace)
    const res = await fetch(`${opts.apiUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    })
    try {
      const result = await res.json()
      // Policy and grant denials use HTTP 403/404/409; other failed HTTP responses
      // cannot confer permission even if their JSON claims approval.
      if (path.startsWith("/authorize") && !res.ok && !(
        [403, 404, 409].includes(res.status) && result?.authorized === false && result?.status === "denied"
      )) {
        return {
          authorized: false,
          status: "error",
          code: typeof result?.code === "string" ? result.code : "SANCTION_HTTP_ERROR",
          reason: typeof result?.reason === "string" ? result.reason : undefined,
          request_id: typeof result?.request_id === "string" ? result.request_id : undefined,
          remediation: typeof result?.remediation === "string" ? result.remediation : undefined,
          error: typeof result?.error === "string" ? result.error : `Sanction returned HTTP ${res.status}`,
        }
      }
      return result
    } catch {
      return {
        authorized: false,
        status: "unreachable",
        code: "SANCTION_UNREACHABLE",
        error: `Sanction returned a non-JSON response (HTTP ${res.status})`,
        reason: `Sanction returned a non-JSON response (HTTP ${res.status}). Do not proceed; stop and notify the owner. Do not retry automatically.`,
      }
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return {
      authorized: false,
      status: "unreachable",
      code: "SANCTION_UNREACHABLE",
      error: `Sanction unreachable: ${detail}`,
      reason: `Sanction is unreachable (${detail}). Do not proceed; stop and notify the owner. Do not retry automatically.`,
    }
  }
}

export function createSanctionMcpServer(opts: SanctionMcpOptions): McpServer {
const profile = opts.toolProfile ?? "wallet"
if (profile !== "wallet" && profile !== "approvals") throw new Error("Unknown MCP tool profile")
const includesTool = (name: string) => profile === "wallet" || APPROVAL_MCP_TOOLS.includes(name)
const server = new McpServer({
  name: "sanction",
  version: MCP_SERVER_VERSION,
  description: profile === "approvals"
    ? "Sanction — approvals and budgets for AI agent actions; no execution-token issuance or vault retrieval (not sanctions/AML screening)"
    : "Sanction — the wallet an AI agent carries: spend, tool, capability, and credential authorization (not sanctions/AML screening)",
})

// Tool: Check spend authorization
if (includesTool("sanction_authorize")) {
server.registerTool(
  "sanction_authorize",
  {
    title: "Request spend authorization",
    description: "Returns a structured decision and readable text. isError:false means the check succeeded, not permission; use authorized and next_action. ALWAYS call this before any purchase, subscription, API credit top-up, or money transfer. Sanction enforces the wallet owner's spend policy: amounts under the auto-approve threshold return immediately; amounts over the escalation threshold pause for human approval; blocked categories are hard-denied. Returns authorized:true with a request_id on approval, or authorized:false with a machine-readable code and remediation hint on denial. When status is 'escalated', wait for the owner's approval — it mints a one-use grant; retry the EXACT same request with that grant_id to proceed. Never proceed with a transaction if this returns false.",
    inputSchema: {
      action: z.enum(["purchase", "subscribe", "transfer"]).describe("Type of spend action: purchase (one-time), subscribe (recurring), transfer (move funds)"),
      amount_usd: z.number().positive().describe("Exact amount in US dollars"),
      merchant: z.string().describe("Vendor or service name, e.g. 'Anthropic', 'AWS', 'Stripe'"),
      category: z.string().describe("Spend category — one of: software, services, research, infrastructure, marketing, legal, other"),
      description: z.string().optional().describe("Brief human-readable description of what this spend is for — helps the wallet owner understand escalations"),
      grant_id: z.string().optional().describe("One-use grant minted when the owner approved a prior escalation of this exact request. Retry with the identical action/amount/merchant/category/description plus this grant_id to consume it. Any field mismatch is denied GRANT_MISMATCH."),
      execution_jwt: z.string().optional().describe("If this spend is part of an execution (the JWT from sanction_request_execution), pass it here to additionally enforce that execution's hard spend cap. The charge is denied EXEC_BUDGET_EXCEEDED if it would exceed the cap."),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  async ({ action, amount_usd, merchant, category, description, grant_id, execution_jwt }, extra) => {
    const result = await callSanction(opts, "/authorize", "POST", { action, amount_usd, merchant, category, description, grant_id }, execution_jwt, traceOf(extra))
    return renderDecisionResult(result, { success: `Authorized — ${merchant} $${amount_usd}`, verb: "proceed" })
  }
)
}

// Tool: Authorize a provisioning action (seats, licenses, infrastructure)
if (includesTool("sanction_authorize_provision")) {
server.registerTool(
  "sanction_authorize_provision",
  {
    title: "Request provisioning authorization",
    description: "Returns a structured decision and readable text. isError:false means the check succeeded, not permission; use authorized and next_action. ALWAYS call this before provisioning any resource — user seats, software licenses, cloud infrastructure, subscriptions with unit counts. One call governs both the resource (the wallet's resource allow/block/escalate lists) and the dollars (the same spend ladder and daily budget as purchases). Amounts or resources over the line pause for human approval; approval mints a one-use grant — retry the exact same request with that grant_id to proceed. Never provision if this returns false.",
    inputSchema: {
      resource: z.string().describe("What is being provisioned, e.g. 'azure.seat', 'm365.license', 'aws.instance'"),
      line_item: z.string().describe("The concrete SKU or plan, e.g. 'Microsoft 365 E3'"),
      quantity: z.number().int().positive().describe("Number of units to provision"),
      unit_price_usd: z.number().positive().optional().describe("Per-unit price in USD. When supplied, quantity × unit_price_usd must equal amount_usd exactly or the request is rejected AMOUNT_MISMATCH."),
      amount_usd: z.number().positive().describe("Total amount in US dollars"),
      category: z.string().describe("Spend category — shares the wallet's category governance and daily budget, e.g. 'licenses', 'infrastructure'"),
      description: z.string().optional().describe("Brief description of what this provision is for — helps the wallet owner understand escalations"),
      grant_id: z.string().optional().describe("One-use grant minted when the owner approved a prior escalation of this exact provision. Retry with identical fields plus this grant_id to consume it."),
      execution_jwt: z.string().optional().describe("If part of an execution, pass the JWT to additionally enforce that execution's hard spend cap."),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  async ({ resource, line_item, quantity, unit_price_usd, amount_usd, category, description, grant_id, execution_jwt }, extra) => {
    const result = await callSanction(opts, 
      "/authorize/provision",
      "POST",
      { resource, line_item, quantity, unit_price_usd, amount_usd, category, description, grant_id },
      execution_jwt,
      traceOf(extra),
    )
    return renderDecisionResult(result, {
      success: `Authorized — ${quantity} × ${line_item} (${resource}) $${amount_usd}`,
      verb: "provision",
    })
  }
)
}

// Tool: Authorize an MCP tool invocation
if (includesTool("sanction_authorize_tool")) {
server.registerTool(
  "sanction_authorize_tool",
  {
    title: "Request tool authorization",
    description: "Returns a structured decision and readable text. isError:false means the check succeeded, not permission; use authorized and next_action. Call this BEFORE invoking any other tool or external action (a different MCP tool, a shell command, a deploy, an email send). For a one-off human decision, set require_approval:true and explain why in approval_reason; no policy edit is needed. This pauses even in observe mode, never auto-approves on timeout, and an initial request cannot override a hard denial. Approval is bound to the exact tool, server and arguments; redeem the one-use grant before acting. Sanction enforces the wallet owner's tool-governance policy: blocked tools are hard-denied, tools off the allow-list are denied, and sensitive tools return escalated for human approval. Returns authorized:true to proceed, or authorized:false with a machine-readable code (TOOL_BLOCKED, TOOL_NOT_ALLOWED, TOOL_ESCALATION_REQUIRED) and a remediation hint. Never invoke the target tool if this returns false.",
    inputSchema: {
      tool: z.string().describe("The exact name of the tool/action about to be invoked, e.g. 'github.create_deployment', 'shell.exec', 'email.send'"),
      server: z.string().optional().describe("The MCP server or integration the tool belongs to, e.g. 'github', 'filesystem' — advisory context for the owner"),
      arguments: z.record(z.string(), z.unknown()).optional().describe("The arguments the tool would be called with — surfaced to the owner on escalation"),
      require_approval: z.boolean().optional().describe("Ask the owner for a one-off human approval even if policy would allow this action. Never execute while waiting."),
      approval_reason: z.string().trim().min(1).max(500).optional().describe("Why you want the owner to review this action; shown in the approval request. Do not include secrets."),
      grant_id: z.string().optional().describe("Redeem a grant minted when the owner approved this tool's escalation — call sanction_check_authorization with the request_id to get the grant_id, then retry this exact request with it"),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  async ({ tool, server: srv, arguments: args, grant_id, require_approval, approval_reason }, extra) => {
    const result = await callSanction(opts, "/authorize/tool", "POST", { tool, server: srv, arguments: args, grant_id, require_approval, approval_reason }, undefined, traceOf(extra))
    return renderDecisionResult(result, { success: `Authorized — ${tool}`, verb: "invoke" })
  }
)
}

// Tool: Authorize acquiring a capability (CAP-1)
if (includesTool("sanction_authorize_capability")) {
server.registerTool(
  "sanction_authorize_capability",
  {
    title: "Request capability authorization",
    description: "Returns a structured decision and readable text. isError:false means the check succeeded, not permission; use authorized and next_action. Call this BEFORE acquiring any new capability — installing a skill or plugin, enabling an integration, or calling an API you haven't used before. Sanction enforces the wallet owner's capability policy: blocked capabilities are hard-denied, capabilities off the allow-list are denied, and sensitive ones return escalated for human approval. Returns authorized:true to proceed, or authorized:false with a machine-readable code (CAPABILITY_BLOCKED, CAPABILITY_NOT_ALLOWED, CAPABILITY_ESCALATION_REQUIRED) and a remediation hint. When escalated, pause for human review, then check sanction_check_authorization once with the request_id; approval mints a one-use grant — retry this exact request with that grant_id. Never acquire the capability if this returns false.",
    inputSchema: {
      capability: z.string().describe("Namespaced identifier of the capability about to be acquired, e.g. 'skill:install:web-scraper', 'plugin:browser', 'api:github.com/repos'"),
      arguments: z.record(z.string(), z.unknown()).optional().describe("Advisory context about the acquisition (version, source, config) — surfaced to the owner on escalation, not policy-evaluated"),
      grant_id: z.string().optional().describe("One-use grant minted when the owner approved a prior escalation of this exact capability. Retry with the identical capability plus this grant_id to consume it."),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  async ({ capability, arguments: args, grant_id }, extra) => {
    const result = await callSanction(opts, "/authorize/capability", "POST", { capability, arguments: args, grant_id }, undefined, traceOf(extra))
    return renderDecisionResult(result, { success: `Authorized — ${capability}`, verb: "acquire" })
  }
)
}

// Tool: Log LLM token usage
if (includesTool("sanction_log_tokens")) {
server.registerTool(
  "sanction_log_tokens",
  {
    title: "Record model usage",
    description: "Call this after every LLM inference call (Claude, GPT-4, Gemini, Llama, etc.) to record token consumption. It is metered against three budget horizons — the seat's daily budget, the seat's monthly budget, and the pooled per-department daily token cap — and returns a 402 budget error naming which horizon was hit if any is exceeded; on a budget error the agent should stop making LLM calls and notify the owner. Report the provider's actual billed cost_usd for the call (from the provider's usage/response), not an estimate — under-reporting silently defeats the budget. Prefer routing calls through the Sanction LLM gateway instead, which meters real usage server-side with no client honesty required.",
    inputSchema: {
      model: z.string().describe("LLM model identifier exactly as returned by the provider, e.g. claude-sonnet-4-6, gpt-4o, gemini-2.0-flash"),
      tokens_in: z.number().int().nonnegative().describe("Input/prompt token count from the API response usage field"),
      tokens_out: z.number().int().nonnegative().describe("Output/completion token count from the API response usage field"),
      cost_usd: z.number().nonnegative().describe("Actual dollar cost of this call — compute from provider pricing or read from API response if available"),
      task: z.string().optional().describe("Short label for what this call did, e.g. 'summarize-email', 'plan-task', 'code-review' — used in spend reports"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async ({ model, tokens_in, tokens_out, cost_usd, task }, extra) => {
    const result = await callSanction(opts, "/tokens", "POST", { model, tokens_in, tokens_out, cost_usd, task }, undefined, traceOf(extra))
    if (result.error) {
      return { content: [{ type: "text" as const, text: `Budget error: ${result.error}` }], isError: true }
    }
    return {
      content: [{ type: "text" as const, text: `Logged $${cost_usd} (${tokens_in + tokens_out} tokens, ${model})` }],
    }
  }
)
}

// Tool: Record a business outcome (CPO-1)
if (includesTool("sanction_log_outcome")) {
server.registerTool(
  "sanction_log_outcome",
  {
    title: "Record business outcome",
    description: "Record a business outcome (an enrollment, booking, signed engagement, conversion) against this wallet. Outcomes are what the wallet's spend answers to: Sanction computes cost-per-outcome over a rolling window and, when the wallet has a cost_per_outcome ceiling configured, throttles further spend to human-gated once the ceiling is crossed. Call this when your system confirms a real outcome — never speculatively. Use dedupe_key (e.g. your CRM record id) so retries never double-count.",
    inputSchema: {
      kind: z.string().describe("Outcome kind in your operating vocabulary, lowercase — e.g. 'enrollment', 'booking', 'signed-engagement'. Must match the policy's outcome_kind for ceiling governance."),
      value_usd: z.number().nonnegative().optional().describe("Optional dollar value of the outcome (e.g. expected LTV or contract value) — reporting only, not governance"),
      play: z.string().optional().describe("Optional campaign/play label for reporting, e.g. 'speed-to-lead'"),
      dedupe_key: z.string().optional().describe("Idempotency key unique per outcome (e.g. CRM record id). Same key = same outcome, never double-counted."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async ({ kind, value_usd, play, dedupe_key }, extra) => {
    const result = await callSanction(opts, "/outcomes", "POST", { kind, value_usd, play, dedupe_key }, undefined, traceOf(extra))
    if (result.error) {
      return { content: [{ type: "text" as const, text: `Outcome error: ${result.error}` }], isError: true }
    }
    return {
      content: [{ type: "text" as const, text: `Outcome recorded: ${kind}${dedupe_key ? ` (${result.deduped ? "deduped" : "new"})` : ""}` }],
    }
  }
)
}

// Tool: Request scoped execution JWT
if (includesTool("sanction_request_execution")) {
server.registerTool(
  "sanction_request_execution",
  {
    title: "Request scoped execution token",
    description: "Mint a short-lived mandate (signed JWT) for a child agent, subprocess, or counterparty: credential scope plus a hard spend cap. Pass the JWT — never the root pxy_ key. Default 15 min, wallet-bound, freeze-aware. The other party verifies it at POST /mandate/verify with no API key. Required before sanction_inject_credential.",
    inputSchema: {
      scope: z.array(z.string()).min(1).describe("List of credential labels the execution needs — e.g. ['STRIPE_KEY', 'OPENAI_API_KEY']. Only these labels will be injectable with the returned JWT. Request minimum required scope."),
      budget_usd: z.number().positive().describe("Hard spend cap for this execution in USD. The execution cannot authorize more than this amount even if the wallet policy allows more. Use the minimum amount needed."),
      ttl_seconds: z.number().int().min(60).max(3600).optional().describe("Token lifetime in seconds. Default 900 (15 min). Use shorter values for quick tasks; max 3600 (1 hour) for long-running jobs."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async ({ scope, budget_usd, ttl_seconds }, extra) => {
    const result = await callSanction(opts, "/exec", "POST", { scope, budget_usd, ttl_seconds }, undefined, traceOf(extra))
    if (result.error) {
      return { content: [{ type: "text" as const, text: `Error: ${result.error}` }], isError: true }
    }
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          jwt: result.jwt,
          jti: result.jti,
          expires_at: result.expires_at,
          clearance: result.clearance,
          scope: result.scope,
          budget_usd: result.budget_usd,
        }),
      }],
    }
  }
)
}

// Tool: Inject credential using execution JWT
if (includesTool("sanction_inject_credential")) {
server.registerTool(
  "sanction_inject_credential",
  {
    title: "Retrieve scoped credential",
    description: "Retrieve a decrypted credential value using a scoped execution JWT. Every injection is audit-logged with timestamp, agent ID, and credential label — raw values are never logged. Use the credential value immediately and do not store it in memory, files, or logs. Fails if the JWT is expired, revoked, or if the requested credential label was not in the original scope.",
    inputSchema: {
      jwt: z.string().describe("Execution JWT returned by sanction_request_execution. Must not be expired."),
      credential_label: z.string().describe("Exact label of the credential to retrieve — must match one of the labels in the JWT scope, e.g. 'STRIPE_KEY', 'DATABASE_URL'. Case-sensitive."),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  async ({ jwt, credential_label }, extra) => {
    const result = await callSanction(opts, "/credentials/inject", "POST", { credential_label }, jwt, traceOf(extra))
    if (result.error) {
      return { content: [{ type: "text" as const, text: `Error: ${result.error}` }], isError: true }
    }
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ label: result.label, type: result.type, value: result.value, expires_at: result.expires_at }),
      }],
    }
  }
)
}

// Tool: Wallet status
if (includesTool("sanction_wallet_status")) {
server.registerTool(
  "sanction_wallet_status",
  {
    title: "Check budget and approval status",
    description: "Check the wallet's current spend and token budget consumption. Returns today's and month-to-date LLM token costs and real-money spend, plus a count of authorization requests pending human approval. Call this at the start of long agentic tasks to confirm budget headroom before initiating expensive operations, or when a prior authorize/log_tokens call returns a budget error.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (_args, extra) => {
    // The agent key names its wallet, so wallet_id is optional — the API
    // derives it server-side. SANCTION_WALLET_ID stays as an explicit override.
    const result = await callSanction(opts, 
      opts.walletId ? `/wallets/stats?wallet_id=${opts.walletId}` : "/wallets/stats",
      "GET",
      undefined,
      undefined,
      traceOf(extra),
    )
    const status = renderWalletStatus(result)
    if (!status.ok) {
      return { content: [{ type: "text" as const, text: status.text }], isError: true }
    }
    return {
      content: [{
        type: "text" as const,
        text: status.text,
      }],
    }
  }
)
}

// Tool: Poll an escalated authorization for its grant
if (includesTool("sanction_check_authorization")) {
server.registerTool(
  "sanction_check_authorization",
  {
    title: "Check and settle authorization",
    description: "Returns a structured decision and readable text. isError:false means the check succeeded, not permission; use authorized and next_action. Poll an authorization request that returned 'escalated', to see whether the wallet owner has approved it yet. Pass the request_id from the escalated authorize/provision/tool response. While pending, pause and wait for human review, then check once; do not poll indefinitely. This check always returns authorized:false. Only next_action:retry_with_grant exposes a usable active grant: retry the ORIGINAL authorize call with identical fields plus that grant_id; execute only after that call returns authorized:true. Consumed, expired, revoked, or missing grants mean stop. If denied, do not proceed. Polling can settle an expired approval under the wallet timeout policy and mint a grant; it is not read-only.",
    inputSchema: {
      request_id: z.string().describe("The request_id from an escalated authorize/provision/tool response"),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  async ({ request_id }, extra) => {
    const result = await callSanction(opts, `/authorize/${encodeURIComponent(request_id)}`, "GET", undefined, undefined, traceOf(extra))
    return renderDecisionResult(result, { requestId: request_id })
  }
)
}

  return server
}

