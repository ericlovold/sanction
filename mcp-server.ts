#!/usr/bin/env node
/**
 * Sanction MCP Server
 *
 * Exposes Sanction governance tools to any MCP-compatible agent host
 * (Claude Desktop, AIIA, etc.).
 *
 * Configuration (env vars):
 *   SANCTION_API_URL   — Sanction API base URL (default: https://sanction.ai/api/v1)
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
 *         "SANCTION_API_URL": "http://localhost:3000/api/v1",
 *         "SANCTION_API_KEY": "pxy_...",
 *         "SANCTION_WALLET_ID": "wallet_..."
 *       }
 *     }
 *   }
 * }
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"

const API_URL = process.env.SANCTION_API_URL ?? "https://sanction.ai/api/v1"
const API_KEY = process.env.SANCTION_API_KEY ?? ""
const WALLET_ID = process.env.SANCTION_WALLET_ID ?? ""

if (!API_KEY) {
  process.stderr.write("SANCTION_API_KEY is required\n")
  process.exit(1)
}

async function callSanction(path: string, method: "GET" | "POST", body?: unknown, bearerToken?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (bearerToken) {
    headers["Authorization"] = `Bearer ${bearerToken}`
  } else {
    headers["x-api-key"] = API_KEY
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
  "Check whether a spend action is authorized by Sanction policy. ALWAYS call this before any purchase, subscription, or transfer — bypassing it means spending without authorization. Returns authorized:true/false plus a stable code (e.g. DAILY_BUDGET_EXCEEDED, ESCALATION_REQUIRED) and remediation hint so you can replan.",
  {
    action: z.enum(["purchase", "subscribe", "transfer"]).describe("Type of spend action"),
    amount_usd: z.number().positive().describe("Amount in US dollars"),
    merchant: z.string().describe("Vendor or service name"),
    category: z.string().describe("Spend category: software, services, research, infrastructure"),
    description: z.string().optional().describe("What this purchase is for"),
  },
  { title: "Authorize Spend", openWorldHint: true },
  async ({ action, amount_usd, merchant, category, description }) => {
    const result = await callSanction("/authorize", "POST", { action, amount_usd, merchant, category, description })
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
  "Log LLM token consumption to Sanction for budget tracking. Call after every Claude, GPT, Gemini, or other LLM inference call.",
  {
    model: z.string().describe("LLM model identifier, e.g. claude-sonnet-4-6"),
    tokens_in: z.number().int().nonnegative().describe("Input/prompt tokens"),
    tokens_out: z.number().int().nonnegative().describe("Output/completion tokens"),
    cost_usd: z.number().nonnegative().describe("Dollar cost of this call"),
    task: z.string().optional().describe("Label for the task this call served"),
  },
  { title: "Log Token Usage", openWorldHint: true },
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
  "Request a short-lived JWT (default 15min) that grants access to specific credentials within a capped budget. Pass this JWT to any subprocess, Docker container, or code-executing agent. Required before calling sanction_inject_credential.",
  {
    scope: z.array(z.string()).min(1).describe("Credential labels needed for this execution"),
    budget_usd: z.number().positive().describe("Maximum spend authority for this execution"),
    ttl_seconds: z.number().int().min(60).max(3600).optional().describe("Token lifetime in seconds (default 900 = 15min)"),
  },
  { title: "Request Execution Token", openWorldHint: true },
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
  "Retrieve a decrypted credential value using a valid execution JWT. The credential must be in the JWT scope. Every injection is audit-logged. Use the JWT from sanction_request_execution.",
  {
    jwt: z.string().describe("Execution JWT from sanction_request_execution"),
    credential_label: z.string().describe("Label of the credential to inject"),
  },
  { title: "Inject Credential", openWorldHint: true },
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
  "Check current wallet spend and token usage. Returns today and month-to-date costs, plus count of pending approvals awaiting human review. Read-only — safe to call any time.",
  {},
  { title: "Wallet Status", readOnlyHint: true, openWorldHint: true },
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
