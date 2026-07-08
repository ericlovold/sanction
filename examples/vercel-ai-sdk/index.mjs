// Sanction + Vercel AI SDK — minimal runnable example.
//
// Two first-successes, in order:
//   1. a model call metered through Sanction's gateway (shows up in your dashboard)
//   2. a real /authorize decision (approved / escalated / denied) before a spend
//
// Setup (from the repo root):
//   source <(bash examples/setup.sh)        # creates a wallet + agent, exports env
//   export ANTHROPIC_API_KEY="sk-ant-..."   # your provider key — forwarded upstream
//   cd examples/vercel-ai-sdk && npm install && npm start

import { createAnthropic } from "@ai-sdk/anthropic"
import { generateText, APICallError } from "ai"

const API = process.env.SANCTION_API_URL ?? "https://getsanction.com/api/v1"
const AGENT_KEY = process.env.SANCTION_API_KEY // pxy_... from examples/setup.sh
if (!AGENT_KEY) throw new Error("SANCTION_API_KEY not set — run: source <(bash examples/setup.sh)")
if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set")

// ── 1. Metered model call ────────────────────────────────────────────────────
// The whole integration: baseURL points at the gateway, x-sanction-key meters it.
const gatewayBase = API.replace(/\/api\/v1$/, "/api/gateway/anthropic/v1")
const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: gatewayBase,
  headers: { "x-sanction-key": AGENT_KEY },
})

let text
try {
  ;({ text } = await generateText({
    model: anthropic("claude-haiku-4-5-20251001"),
    prompt: "In one sentence: recommend a CI/CD tool under $50/month.",
  }))
} catch (err) {
  if (APICallError.isInstance(err) && err.statusCode === 402) {
    console.log("Gateway returned 402 — this agent's token budget is exhausted. That IS governance working.")
    process.exit(0)
  }
  throw err
}
console.log("Model (metered through Sanction):", text.trim())

// ── 2. Pre-spend authorization ───────────────────────────────────────────────
// Before acting on the recommendation, ask the wallet. 403 = denied by policy,
// which is a decision, not an error.
const resp = await fetch(`${API}/authorize`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-api-key": AGENT_KEY },
  body: JSON.stringify({
    action: "subscribe",
    amount_usd: 29,
    merchant: "GitHub Actions",
    category: "software",
    description: "CI/CD subscription recommended by the agent",
  }),
})
const decision = await resp.json()

console.log(`Authorize $29 subscribe → ${decision.status}${decision.reason ? ` (${decision.reason})` : ""}`)
switch (decision.status) {
  case "approved":
    console.log("Proceed with the purchase — the decision is in your audit feed.")
    break
  case "escalated":
    console.log(`A human must approve. Poll GET /authorize/${decision.request_id} for the grant, then retry with grant_id.`)
    break
  case "denied":
    console.log("Do not proceed. The policy said no, with the reason above.")
    break
}
