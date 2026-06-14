#!/usr/bin/env node
/**
 * AutoFlux MCP Server
 *
 * Exposes AutoFlux governance tools to any MCP-compatible agent host
 * (Claude Desktop, AIIA, etc.).
 *
 * Configuration (env vars):
 *   AUTOFLUX_API_URL   — AutoFlux API base URL (default: https://autoflux.ai/api/v1)
 *   AUTOFLUX_API_KEY   — Agent API key (pxy_...)
 *   AUTOFLUX_WALLET_ID — Wallet ID for status queries
 *
 * Usage:
 *   npx autoflux-mcp
 *   node mcp-server.js
 *
 * Claude Desktop config (~/.claude/claude_desktop_config.json):
 * {
 *   "mcpServers": {
 *     "autoflux": {
 *       "command": "npx",
 *       "args": ["autoflux-mcp"],
 *       "env": {
 *         "AUTOFLUX_API_URL": "http://localhost:3000/api/v1",
 *         "AUTOFLUX_API_KEY": "pxy_...",
 *         "AUTOFLUX_WALLET_ID": "wallet_..."
 *       }
 *     }
 *   }
 * }
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"

const API_URL = process.env.AUTOFLUX_API_URL ?? "https://autoflux.ai/api/v1"
const API_KEY = process.env.AUTOFLUX_API_KEY ?? ""
const WALLET_ID = process.env.AUTOFLUX_WALLET_ID ?? ""

if (!API_KEY) {
  process.stderr.write("AUTOFLUX_API_KEY is required\n")
  process.exit(1)
}

async function callAutoFlux(path: string, method: "GET" | "POST", body?: unknown, bearerToken?: string) {
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
  name: "autoflux",
  version: "1.0.0",
  description: "AutoFlux — agent wallet, credential vault, and governance layer",
})

// Tool: Check spend authorization
server.tool(
  "autoflux_authorize",
  "Check whether a spend action is authorized by AutoFlux policy. ALWAYS call this before any purchase, subscription, or transfer. Returns authorized:true/false with reason.",
  {
    action: z.enum(["purchase", "subscribe", "transfer"]).describe("Type of spend action"),
    amount_usd: z.number().positive().describe("Amount in US dollars"),
    merchant: z.string().describe("Vendor or service name"),
    category: z.string().describe("Spend category: software, services, research, infrastructure"),
    description: z.string().optional().describe("What this purchase is for"),
  },
  async ({ action, amount_usd, merchant, category, description }) => {
    const result = await callAutoFlux("/authorize", "POST", { action, amount_usd, merchant, category, description })
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
  "autoflux_log_tokens",
  "Log LLM token consumption to AutoFlux for budget tracking. Call after every Claude, GPT, Gemini, or other LLM inference call.",
  {
    model: z.string().describe("LLM model identifier, e.g. claude-sonnet-4-6"),
    tokens_in: z.number().int().nonnegative().describe("Input/prompt tokens"),
    tokens_out: z.number().int().nonnegative().describe("Output/completion tokens"),
    cost_usd: z.number().nonnegative().describe("Dollar cost of this call"),
    task: z.string().optional().describe("Label for the task this call served"),
  },
  async ({ model, tokens_in, tokens_out, cost_usd, task }) => {
    const result = await callAutoFlux("/tokens", "POST", { model, tokens_in, tokens_out, cost_usd, task })
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
  "autoflux_request_execution",
  "Request a short-lived JWT (default 15min) that grants access to specific credentials within a capped budget. Pass this JWT to any subprocess, Docker container, or code-executing agent. Required before calling autoflux_inject_credential.",
  {
    scope: z.array(z.string()).min(1).describe("Credential labels needed for this execution"),
    budget_usd: z.number().positive().describe("Maximum spend authority for this execution"),
    ttl_seconds: z.number().int().min(60).max(3600).optional().describe("Token lifetime in seconds (default 900 = 15min)"),
  },
  async ({ scope, budget_usd, ttl_seconds }) => {
    const result = await callAutoFlux("/exec", "POST", { scope, budget_usd, ttl_seconds })
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
  "autoflux_inject_credential",
  "Retrieve a decrypted credential value using a valid execution JWT. The credential must be in the JWT scope. Every injection is audit-logged. Use the JWT from autoflux_request_execution.",
  {
    jwt: z.string().describe("Execution JWT from autoflux_request_execution"),
    credential_label: z.string().describe("Label of the credential to inject"),
  },
  async ({ jwt, credential_label }) => {
    const result = await callAutoFlux("/credentials/inject", "POST", { credential_label }, jwt)
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
  "autoflux_wallet_status",
  "Check current wallet spend and token usage. Returns today and month-to-date costs, plus count of pending approvals awaiting human review.",
  {},
  async () => {
    if (!WALLET_ID) {
      return { content: [{ type: "text" as const, text: "AUTOFLUX_WALLET_ID not configured" }], isError: true }
    }
    const result = await callAutoFlux(`/wallets/stats?wallet_id=${WALLET_ID}`, "GET")
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
