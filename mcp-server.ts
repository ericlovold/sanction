#!/usr/bin/env node
/**
 * Sanction MCP Server
 *
 * Exposes Sanction governance tools to any MCP-compatible agent host
 * (Claude Desktop, AIIA, etc.).
 *
 * Configuration (env vars):
 *   SANCTION_API_URL   — Sanction API base URL (default: https://getsanction.com/api/v1)
 *   SANCTION_API_KEY   — Agent API key (pxy_...)
 *   SANCTION_WALLET_ID — Wallet ID for status queries
 *
 * Usage:
 *   npx sanction-mcp
 *   node mcp-server.js
 *
 * Claude Desktop config (~/.claude/claude_desktop_config.json):
 * {
 *   "mcpServers": {
 *     "sanction": {
 *       "command": "npx",
 *       "args": ["sanction-mcp"],
 *       "env": {
 *         "SANCTION_API_KEY": "pxy_...",
 *         "SANCTION_WALLET_ID": "<wallet_id>"
 *       }
 *     }
 *   }
 * }
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { renderWalletStatus } from "./lib/mcpWalletStatus"

const API_URL = process.env.SANCTION_API_URL ?? "https://getsanction.com/api/v1"
const API_KEY = process.env.SANCTION_API_KEY ?? ""
const WALLET_ID = process.env.SANCTION_WALLET_ID ?? ""

if (!API_KEY) {
  process.stderr.write(
    [
      "",
      "Sanction MCP — SANCTION_API_KEY is not set.",
      "",
      "This server is started by your MCP host (Claude Desktop, agent runtimes),",
      "not run directly. Add it to your host config with your keys:",
      "",
      '  "sanction": {',
      '    "command": "npx",',
      '    "args": ["sanction-mcp"],',
      '    "env": { "SANCTION_API_KEY": "pxy_...", "SANCTION_WALLET_ID": "..." }',
      "  }",
      "",
      "Or run it directly to test:",
      "  SANCTION_API_KEY=pxy_... SANCTION_WALLET_ID=... npx sanction-mcp",
      "",
      "No keys yet? Create a wallet free at https://getsanction.com/start",
      "",
    ].join("\n") + "\n",
  )
  process.exit(1)
}

async function callSanction(path: string, method: "GET" | "POST", body?: unknown, bearerToken?: string) {
  // x-api-key identifies the agent on every call; a Bearer token (execution JWT)
  // is additive — used by inject and to enforce an execution's spend cap.
  const headers: Record<string, string> = { "Content-Type": "application/json", "x-api-key": API_KEY }
  if (bearerToken) {
    headers["Authorization"] = `Bearer ${bearerToken}`
  }
  // Transport failures must degrade to a clear deny, not an opaque JS error:
  // this tool fronts real money decisions, and an ambiguous failure invites
  // agents to retry-loop or (worse) proceed. Normalize network errors,
  // timeouts, and non-JSON bodies (gateway 502 pages) into the same
  // { authorized:false, code, reason } contract every tool description promises.
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    })
    try {
      return await res.json()
    } catch {
      return {
        authorized: false,
        status: "unreachable",
        code: "SANCTION_UNREACHABLE",
        error: `Sanction returned a non-JSON response (HTTP ${res.status})`,
        reason: `Sanction returned a non-JSON response (HTTP ${res.status}). Treat as denied; retry once, then stop and notify the owner.`,
      }
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return {
      authorized: false,
      status: "unreachable",
      code: "SANCTION_UNREACHABLE",
      error: `Sanction unreachable: ${detail}`,
      reason: `Sanction is unreachable (${detail}). Treat as denied; retry once, then stop and notify the owner.`,
    }
  }
}

// One renderer for every authorize tool, so the escalation/grant loop and error
// surfacing stay identical across spend/provision/tool (they had drifted).
//   - success: names the request_id (needed to poll for the grant on escalation)
//   - escalated: tells the agent to poll via sanction_check_authorization
//   - a bare { error } body (401 bad key, 400 validation, 403 WALLET_FROZEN with
//     no status/reason envelope) is surfaced verbatim with its code, NOT masked
//     as a generic policy denial — the agent must fix config / stop, not replan.
function renderAuthResult(
  result: Record<string, unknown>,
  opts: { success: string; verb: string },
): { content: { type: "text"; text: string }[]; isError: boolean } {
  const authorized = result.authorized === true
  const status = typeof result.status === "string" ? result.status : undefined
  const code = typeof result.code === "string" ? result.code : undefined
  const reason = typeof result.reason === "string" ? result.reason : undefined
  const error = typeof result.error === "string" ? result.error : undefined
  const requestId = typeof result.request_id === "string" ? result.request_id : undefined

  let text: string
  if (authorized) {
    text = `✓ ${opts.success}${requestId ? ` (${requestId})` : ""}${result.grant_status === "consumed" ? " · grant consumed" : ""}`
  } else if (!status && (code || error)) {
    // Non-policy failure (auth/validation/frozen): surface the real cause.
    text = `✗ ${code ?? "ERROR"} — ${reason ?? error}. Do not ${opts.verb}; this is not a policy denial — resolve it or stop and notify the owner.`
  } else if (status === "escalated") {
    text = `✗ ESCALATED — ${reason ?? "Awaiting human approval"}. Call sanction_check_authorization with request_id ${requestId ?? "(see the record)"} until it returns a grant_id, then retry this exact request with it.`
  } else {
    text = `✗ ${status?.toUpperCase() ?? "DENIED"}${code ? ` (${code})` : ""} — ${reason ?? error ?? "Not authorized"}. Do not ${opts.verb}.`
  }
  return { content: [{ type: "text" as const, text }], isError: !authorized }
}

const server = new McpServer({
  name: "sanction",
  version: "0.6.0",
  description: "Sanction — pre-action spend & credential authorization for autonomous AI agents (not sanctions/AML screening)",
})

// Tool: Check spend authorization
server.tool(
  "sanction_authorize",
  "ALWAYS call this before any purchase, subscription, API credit top-up, or money transfer. Sanction enforces the wallet owner's spend policy: amounts under the auto-approve threshold return immediately; amounts over the escalation threshold pause for human approval; blocked categories are hard-denied. Returns authorized:true with a request_id on approval, or authorized:false with a machine-readable code and remediation hint on denial. When status is 'escalated', wait for the owner's approval — it mints a one-use grant; retry the EXACT same request with that grant_id to proceed. Never proceed with a transaction if this returns false.",
  {
    action: z.enum(["purchase", "subscribe", "transfer"]).describe("Type of spend action: purchase (one-time), subscribe (recurring), transfer (move funds)"),
    amount_usd: z.number().positive().describe("Exact amount in US dollars"),
    merchant: z.string().describe("Vendor or service name, e.g. 'Anthropic', 'AWS', 'Stripe'"),
    category: z.string().describe("Spend category — one of: software, services, research, infrastructure, marketing, legal, other"),
    description: z.string().optional().describe("Brief human-readable description of what this spend is for — helps the wallet owner understand escalations"),
    grant_id: z.string().optional().describe("One-use grant minted when the owner approved a prior escalation of this exact request. Retry with the identical action/amount/merchant/category/description plus this grant_id to consume it. Any field mismatch is denied GRANT_MISMATCH."),
    execution_jwt: z.string().optional().describe("If this spend is part of an execution (the JWT from sanction_request_execution), pass it here to additionally enforce that execution's hard spend cap. The charge is denied EXEC_BUDGET_EXCEEDED if it would exceed the cap."),
  },
  async ({ action, amount_usd, merchant, category, description, grant_id, execution_jwt }) => {
    const result = await callSanction("/authorize", "POST", { action, amount_usd, merchant, category, description, grant_id }, execution_jwt)
    return renderAuthResult(result, { success: `Authorized — ${merchant} $${amount_usd}`, verb: "proceed" })
  }
)

// Tool: Authorize a provisioning action (seats, licenses, infrastructure)
server.tool(
  "sanction_authorize_provision",
  "ALWAYS call this before provisioning any resource — user seats, software licenses, cloud infrastructure, subscriptions with unit counts. One call governs both the resource (the wallet's resource allow/block/escalate lists) and the dollars (the same spend ladder and daily budget as purchases). Amounts or resources over the line pause for human approval; approval mints a one-use grant — retry the exact same request with that grant_id to proceed. Never provision if this returns false.",
  {
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
  async ({ resource, line_item, quantity, unit_price_usd, amount_usd, category, description, grant_id, execution_jwt }) => {
    const result = await callSanction(
      "/authorize/provision",
      "POST",
      { resource, line_item, quantity, unit_price_usd, amount_usd, category, description, grant_id },
      execution_jwt,
    )
    return renderAuthResult(result, {
      success: `Authorized — ${quantity} × ${line_item} (${resource}) $${amount_usd}`,
      verb: "provision",
    })
  }
)

// Tool: Authorize an MCP tool invocation
server.tool(
  "sanction_authorize_tool",
  "Call this BEFORE invoking any other tool or external action (a different MCP tool, a shell command, a deploy, an email send). Sanction enforces the wallet owner's tool-governance policy: blocked tools are hard-denied, tools off the allow-list are denied, and sensitive tools return escalated for human approval. Returns authorized:true to proceed, or authorized:false with a machine-readable code (TOOL_BLOCKED, TOOL_NOT_ALLOWED, TOOL_ESCALATION_REQUIRED) and a remediation hint. Never invoke the target tool if this returns false.",
  {
    tool: z.string().describe("The exact name of the tool/action about to be invoked, e.g. 'github.create_deployment', 'shell.exec', 'email.send'"),
    server: z.string().optional().describe("The MCP server or integration the tool belongs to, e.g. 'github', 'filesystem' — advisory context for the owner"),
    arguments: z.record(z.string(), z.unknown()).optional().describe("The arguments the tool would be called with — surfaced to the owner on escalation"),
    grant_id: z.string().optional().describe("Redeem a grant minted when the owner approved this tool's escalation — call sanction_check_authorization with the request_id to get the grant_id, then retry this exact request with it"),
  },
  async ({ tool, server: srv, arguments: args, grant_id }) => {
    const result = await callSanction("/authorize/tool", "POST", { tool, server: srv, arguments: args, grant_id })
    return renderAuthResult(result, { success: `Authorized — ${tool}`, verb: "invoke" })
  }
)

// Tool: Authorize acquiring a capability (CAP-1)
server.tool(
  "sanction_authorize_capability",
  "Call this BEFORE acquiring any new capability — installing a skill or plugin, enabling an integration, or calling an API you haven't used before. Sanction enforces the wallet owner's capability policy: blocked capabilities are hard-denied, capabilities off the allow-list are denied, and sensitive ones return escalated for human approval. Returns authorized:true to proceed, or authorized:false with a machine-readable code (CAPABILITY_BLOCKED, CAPABILITY_NOT_ALLOWED, CAPABILITY_ESCALATION_REQUIRED) and a remediation hint. When escalated, poll sanction_check_authorization with the request_id; approval mints a one-use grant — retry this exact request with that grant_id. Never acquire the capability if this returns false.",
  {
    capability: z.string().describe("Namespaced identifier of the capability about to be acquired, e.g. 'skill:install:web-scraper', 'plugin:browser', 'api:github.com/repos'"),
    arguments: z.record(z.string(), z.unknown()).optional().describe("Advisory context about the acquisition (version, source, config) — surfaced to the owner on escalation, not policy-evaluated"),
    grant_id: z.string().optional().describe("One-use grant minted when the owner approved a prior escalation of this exact capability. Retry with the identical capability plus this grant_id to consume it."),
  },
  async ({ capability, arguments: args, grant_id }) => {
    const result = await callSanction("/authorize/capability", "POST", { capability, arguments: args, grant_id })
    return renderAuthResult(result, { success: `Authorized — ${capability}`, verb: "acquire" })
  }
)

// Tool: Log LLM token usage
server.tool(
  "sanction_log_tokens",
  "Call this after every LLM inference call (Claude, GPT-4, Gemini, Llama, etc.) to record token consumption. It is metered against three budget horizons — the seat's daily budget, the seat's monthly budget, and the pooled per-department daily token cap — and returns a 402 budget error naming which horizon was hit if any is exceeded; on a budget error the agent should stop making LLM calls and notify the owner. Report the provider's actual billed cost_usd for the call (from the provider's usage/response), not an estimate — under-reporting silently defeats the budget. Prefer routing calls through the Sanction LLM gateway instead, which meters real usage server-side with no client honesty required.",
  {
    model: z.string().describe("LLM model identifier exactly as returned by the provider, e.g. claude-sonnet-4-6, gpt-4o, gemini-2.0-flash"),
    tokens_in: z.number().int().nonnegative().describe("Input/prompt token count from the API response usage field"),
    tokens_out: z.number().int().nonnegative().describe("Output/completion token count from the API response usage field"),
    cost_usd: z.number().nonnegative().describe("Actual dollar cost of this call — compute from provider pricing or read from API response if available"),
    task: z.string().optional().describe("Short label for what this call did, e.g. 'summarize-email', 'plan-task', 'code-review' — used in spend reports"),
  },
  async ({ model, tokens_in, tokens_out, cost_usd, task }) => {
    const result = await callSanction("/tokens", "POST", { model, tokens_in, tokens_out, cost_usd, task })
    if (result.error) {
      return { content: [{ type: "text" as const, text: `Budget error: ${result.error}` }], isError: true }
    }
    return {
      content: [{ type: "text" as const, text: `Logged $${cost_usd} (${tokens_in + tokens_out} tokens, ${model})` }],
    }
  }
)

// Tool: Record a business outcome (CPO-1)
server.tool(
  "sanction_log_outcome",
  "Record a business outcome (an enrollment, booking, signed engagement, conversion) against this wallet. Outcomes are what the wallet's spend answers to: Sanction computes cost-per-outcome over a rolling window and, when the wallet has a cost_per_outcome ceiling configured, throttles further spend to human-gated once the ceiling is crossed. Call this when your system confirms a real outcome — never speculatively. Use dedupe_key (e.g. your CRM record id) so retries never double-count.",
  {
    kind: z.string().describe("Outcome kind in your operating vocabulary, lowercase — e.g. 'enrollment', 'booking', 'signed-engagement'. Must match the policy's outcome_kind for ceiling governance."),
    value_usd: z.number().nonnegative().optional().describe("Optional dollar value of the outcome (e.g. expected LTV or contract value) — reporting only, not governance"),
    play: z.string().optional().describe("Optional campaign/play label for reporting, e.g. 'speed-to-lead'"),
    dedupe_key: z.string().optional().describe("Idempotency key unique per outcome (e.g. CRM record id). Same key = same outcome, never double-counted."),
  },
  async ({ kind, value_usd, play, dedupe_key }) => {
    const result = await callSanction("/outcomes", "POST", { kind, value_usd, play, dedupe_key })
    if (result.error) {
      return { content: [{ type: "text" as const, text: `Outcome error: ${result.error}` }], isError: true }
    }
    return {
      content: [{ type: "text" as const, text: `Outcome recorded: ${kind}${dedupe_key ? ` (${result.deduped ? "deduped" : "new"})` : ""}` }],
    }
  }
)

// Tool: Request scoped execution JWT
server.tool(
  "sanction_request_execution",
  "Issue a short-lived signed JWT that authorizes access to specific credentials within a hard spend cap. Call this before spawning any subprocess, container, or delegated agent that needs secrets — pass the returned JWT via environment variable or stdin, never hardcode credentials directly. The JWT expires automatically (default 15 min) and is single-wallet-scoped, so a compromised token can't access other wallets. Required before calling sanction_inject_credential.",
  {
    scope: z.array(z.string()).min(1).describe("List of credential labels the execution needs — e.g. ['STRIPE_KEY', 'OPENAI_API_KEY']. Only these labels will be injectable with the returned JWT. Request minimum required scope."),
    budget_usd: z.number().positive().describe("Hard spend cap for this execution in USD. The execution cannot authorize more than this amount even if the wallet policy allows more. Use the minimum amount needed."),
    ttl_seconds: z.number().int().min(60).max(3600).optional().describe("Token lifetime in seconds. Default 900 (15 min). Use shorter values for quick tasks; max 3600 (1 hour) for long-running jobs."),
  },
  async ({ scope, budget_usd, ttl_seconds }) => {
    const result = await callSanction("/exec", "POST", { scope, budget_usd, ttl_seconds })
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

// Tool: Inject credential using execution JWT
server.tool(
  "sanction_inject_credential",
  "Retrieve a decrypted credential value using a scoped execution JWT. Every injection is audit-logged with timestamp, agent ID, and credential label — raw values are never logged. Use the credential value immediately and do not store it in memory, files, or logs. Fails if the JWT is expired, revoked, or if the requested credential label was not in the original scope.",
  {
    jwt: z.string().describe("Execution JWT returned by sanction_request_execution. Must not be expired."),
    credential_label: z.string().describe("Exact label of the credential to retrieve — must match one of the labels in the JWT scope, e.g. 'STRIPE_KEY', 'DATABASE_URL'. Case-sensitive."),
  },
  async ({ jwt, credential_label }) => {
    const result = await callSanction("/credentials/inject", "POST", { credential_label }, jwt)
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

// Tool: Wallet status
server.tool(
  "sanction_wallet_status",
  "Check the wallet's current spend and token budget consumption. Returns today's and month-to-date LLM token costs and real-money spend, plus a count of authorization requests pending human approval. Call this at the start of long agentic tasks to confirm budget headroom before initiating expensive operations, or when a prior authorize/log_tokens call returns a budget error.",
  {},
  async () => {
    if (!WALLET_ID) {
      return { content: [{ type: "text" as const, text: "SANCTION_WALLET_ID not configured" }], isError: true }
    }
    const result = await callSanction(`/wallets/stats?wallet_id=${WALLET_ID}`, "GET")
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

// Tool: Poll an escalated authorization for its grant
server.tool(
  "sanction_check_authorization",
  "Poll an authorization request that returned 'escalated', to see whether the wallet owner has approved it yet. Pass the request_id from the escalated authorize/provision/tool response. While pending, status stays 'escalated' — wait and poll again. Once the owner approves, status becomes 'approved' and a one-use grant_id is returned: retry the ORIGINAL authorize call with the identical fields plus that grant_id to complete the action. If denied, do not proceed.",
  {
    request_id: z.string().describe("The request_id from an escalated authorize/provision/tool response"),
  },
  async ({ request_id }) => {
    const result = await callSanction(`/authorize/${encodeURIComponent(request_id)}`, "GET")
    const status = typeof result.status === "string" ? result.status : undefined
    const grantId = typeof result.grant_id === "string" ? result.grant_id : undefined
    if (status === "approved" && grantId) {
      return {
        content: [{
          type: "text" as const,
          text: `✓ APPROVED — retry your original request with grant_id: ${grantId}`,
        }],
      }
    }
    if (status === "escalated" || status === "pending") {
      return { content: [{ type: "text" as const, text: "⏳ Still awaiting the owner's approval — poll again shortly." }] }
    }
    if (status === "denied") {
      return {
        content: [{ type: "text" as const, text: `✗ DENIED — ${typeof result.reason === "string" ? result.reason : "the owner declined"}. Do not proceed.` }],
        isError: true,
      }
    }
    return {
      content: [{ type: "text" as const, text: `Could not read the authorization: ${typeof result.error === "string" ? result.error : "unknown error"}` }],
      isError: true,
    }
  }
)

const transport = new StdioServerTransport()
await server.connect(transport)
