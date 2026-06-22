#!/usr/bin/env node
/**
 * Sanction MCP Server
 *
 * Exposes Sanction governance tools to any MCP-compatible agent host
 * (Claude Desktop, AIIA, etc.).
 *
 * Configuration (env vars):
 *   SANCTION_API_URL   — Sanction API base URL (default: https://onesanction.com/api/v1)
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

const API_URL = process.env.SANCTION_API_URL ?? "https://onesanction.com/api/v1"
const API_KEY = process.env.SANCTION_API_KEY ?? ""
const WALLET_ID = process.env.SANCTION_WALLET_ID ?? ""

if (!API_KEY) {
  process.stderr.write("SANCTION_API_KEY is required\n")
  process.exit(1)
}

async function callSanction(path: string, method: "GET" | "POST", body?: unknown, bearerToken?: string) {
  // x-api-key identifies the agent on every call; a Bearer token (execution JWT)
  // is additive — used by inject and to enforce an execution's spend cap.
  const headers: Record<string, string> = { "Content-Type": "application/json", "x-api-key": API_KEY }
  if (bearerToken) {
    headers["Authorization"] = `Bearer ${bearerToken}`
  }
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  return res.json()
}

const server = new McpServer({
  name: "sanction",
  version: "1.0.0",
  description: "Sanction — agent wallet, credential vault, and governance layer",
})

// Tool: Check spend authorization
server.tool(
  "sanction_authorize",
  "ALWAYS call this before any purchase, subscription, API credit top-up, or money transfer. Sanction enforces the wallet owner's spend policy: amounts under the auto-approve threshold return immediately; amounts over the escalation threshold pause for human approval; blocked categories are hard-denied. Returns authorized:true with a request_id on approval, or authorized:false with a machine-readable code and remediation hint on denial. Never proceed with a transaction if this returns false.",
  {
    action: z.enum(["purchase", "subscribe", "transfer"]).describe("Type of spend action: purchase (one-time), subscribe (recurring), transfer (move funds)"),
    amount_usd: z.number().positive().describe("Exact amount in US dollars"),
    merchant: z.string().describe("Vendor or service name, e.g. 'Anthropic', 'AWS', 'Stripe'"),
    category: z.string().describe("Spend category — one of: software, services, research, infrastructure, marketing, legal, other"),
    description: z.string().optional().describe("Brief human-readable description of what this spend is for — helps the wallet owner understand escalations"),
    execution_jwt: z.string().optional().describe("If this spend is part of an execution (the JWT from sanction_request_execution), pass it here to additionally enforce that execution's hard spend cap. The charge is denied EXEC_BUDGET_EXCEEDED if it would exceed the cap."),
  },
  async ({ action, amount_usd, merchant, category, description, execution_jwt }) => {
    const result = await callSanction("/authorize", "POST", { action, amount_usd, merchant, category, description }, execution_jwt)
    const authorized = result.authorized === true
    return {
      content: [{
        type: "text" as const,
        text: authorized
          ? `✓ Authorized — ${merchant} $${amount_usd} (${result.request_id})`
          : `✗ ${result.status?.toUpperCase() ?? "DENIED"} — ${result.reason ?? "Not authorized"}. ${result.status === "escalated" ? "Awaiting human approval." : "Do not proceed."}`,
      }],
      isError: !authorized,
    }
  }
)

// Tool: Log LLM token usage
server.tool(
  "sanction_log_tokens",
  "Call this after every LLM inference call (Claude, GPT-4, Gemini, Llama, etc.) to record token consumption against the wallet's daily budget. If the daily token budget is exceeded, returns a budget error — the agent should stop making LLM calls and notify the wallet owner. Cost estimates: claude-sonnet-4-6 is $3/M input + $15/M output; gpt-4o is $2.50/M input + $10/M output.",
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
    return {
      content: [{
        type: "text" as const,
        text: [
          `Today — tokens: $${result.today?.token_cost_usd?.toFixed(4)} | spend: $${result.today?.spend_usd?.toFixed(2)}`,
          `Month — tokens: $${result.month?.token_cost_usd?.toFixed(4)} | spend: $${result.month?.spend_usd?.toFixed(2)}`,
          result.pending_approvals > 0 ? `⚠ ${result.pending_approvals} pending approval(s)` : "No pending approvals",
        ].join("\n"),
      }],
    }
  }
)

const transport = new StdioServerTransport()
await server.connect(transport)
