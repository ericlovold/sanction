import { db } from "./db"

// LLM gateway: agents point their provider client at /api/gateway/<provider>/…
// and authenticate with their Sanction agent key (x-sanction-key header). We
// forward the request to the real provider, read token usage off the response,
// and meter it — no per-call instrumentation by the agent.

type Usage = { model: string; tokensIn: number; tokensOut: number }

export const GATEWAY_PROVIDERS: Record<
  string,
  { baseUrl: string; extract: (body: unknown, path: string) => Usage | null }
> = {
  anthropic: {
    baseUrl: "https://api.anthropic.com",
    extract: (body) => {
      const b = body as { model?: string; usage?: { input_tokens?: number; output_tokens?: number } }
      if (!b?.usage) return null
      return { model: b.model ?? "claude", tokensIn: b.usage.input_tokens ?? 0, tokensOut: b.usage.output_tokens ?? 0 }
    },
  },
  openai: {
    baseUrl: "https://api.openai.com",
    // Handles both Chat Completions (prompt/completion_tokens) and the Responses
    // API (input/output_tokens) — the AI SDK's native OpenAI provider uses the
    // latter by default, so we must meter both or those calls record zero.
    extract: (body) => {
      const b = body as { model?: string; usage?: { prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number } }
      const u = b?.usage
      if (!u) return null
      const tokensIn = u.prompt_tokens ?? u.input_tokens ?? 0
      const tokensOut = u.completion_tokens ?? u.output_tokens ?? 0
      if (!tokensIn && !tokensOut) return null
      return { model: b.model ?? "gpt", tokensIn, tokensOut }
    },
  },
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com",
    extract: (body, path) => {
      const b = body as { modelVersion?: string; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }
      if (!b?.usageMetadata) return null
      const model = b.modelVersion ?? path.match(/models\/([^:/]+)/)?.[1] ?? "gemini"
      return { model, tokensIn: b.usageMetadata.promptTokenCount ?? 0, tokensOut: b.usageMetadata.candidatesTokenCount ?? 0 }
    },
  },
}

// Approximate USD per 1M tokens [input, output]. Longest prefix match wins.
// These are estimates for cost tracking; tune as provider pricing changes.
const PRICING: Array<[string, number, number]> = [
  ["claude-opus", 15, 75],
  ["claude-sonnet", 3, 15],
  ["claude-haiku", 1, 5],
  ["gpt-4o-mini", 0.15, 0.6],
  ["gpt-4o", 2.5, 10],
  ["gpt-4.1", 2, 8],
  ["o1", 15, 60],
  ["gemini-2.5-pro", 1.25, 10],
  ["gemini-3-pro", 2, 12],
  ["gemini-pro", 1.25, 5],
  ["gemini-flash-lite", 0.0375, 0.15],
  ["gemini-flash", 0.075, 0.3],
  ["gemini", 0.075, 0.3],
]

export function costUsd(model: string, tokensIn: number, tokensOut: number): number {
  const m = model.toLowerCase()
  const hit = PRICING.filter(([k]) => m.includes(k)).sort((a, b) => b[0].length - a[0].length)[0]
  if (!hit) return 0
  return Number((((tokensIn * hit[1]) + (tokensOut * hit[2])) / 1e6).toFixed(6))
}

export function dayStart(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

type GatewayAgent = {
  id: string
  isActive: boolean
  dailyTokenBudgetUsd: number | null
  wallet: { policy: { dailyTokenBudgetUsd: number } | null }
}

/** Effective daily token budget in dollars, or null if no policy (no enforcement). */
export function tokenBudgetUsd(agent: GatewayAgent): number | null {
  const cents = agent.dailyTokenBudgetUsd ?? agent.wallet.policy?.dailyTokenBudgetUsd
  return cents == null ? null : cents / 100
}

/** True if the agent has already spent its daily token budget. */
export async function isBudgetExhausted(agent: GatewayAgent): Promise<{ exhausted: boolean; spent: number; budget: number | null }> {
  const budget = tokenBudgetUsd(agent)
  if (budget == null) return { exhausted: false, spent: 0, budget: null }
  const agg = await db.tokenLog.aggregate({ where: { agentId: agent.id, createdAt: { gte: dayStart() } }, _sum: { costUsd: true } })
  const spent = agg._sum.costUsd ?? 0
  return { exhausted: spent >= budget, spent, budget }
}

type StreamData = {
  type?: string
  model?: string
  modelVersion?: string
  message?: { model?: string; usage?: { input_tokens?: number; output_tokens?: number } }
  usage?: { output_tokens?: number; input_tokens?: number; prompt_tokens?: number; completion_tokens?: number }
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
  // OpenAI Responses API streaming nests usage on the terminal event.
  response?: { model?: string; usage?: { input_tokens?: number; output_tokens?: number } }
}

/**
 * Accumulates token usage from a provider's SSE stream. Anthropic and Gemini
 * emit usage in-stream by default; OpenAI only when the client sets
 * stream_options.include_usage. feed() each parsed `data:` JSON; result() at end.
 */
export function makeStreamMeter(provider: string) {
  const acc: Usage = { model: "", tokensIn: 0, tokensOut: 0 }
  return {
    feed(d: StreamData) {
      if (provider === "anthropic") {
        if (d.type === "message_start" && d.message) {
          acc.model = d.message.model ?? acc.model
          acc.tokensIn = d.message.usage?.input_tokens ?? acc.tokensIn
          acc.tokensOut = d.message.usage?.output_tokens ?? acc.tokensOut
        } else if (d.type === "message_delta" && d.usage) {
          acc.tokensOut = d.usage.output_tokens ?? acc.tokensOut
        }
      } else if (provider === "openai") {
        if (d.model) acc.model = d.model
        if (d.usage) {
          acc.tokensIn = d.usage.prompt_tokens ?? d.usage.input_tokens ?? acc.tokensIn
          acc.tokensOut = d.usage.completion_tokens ?? d.usage.output_tokens ?? acc.tokensOut
        }
        // Responses API: usage arrives nested on the terminal event.
        if (d.response?.usage) {
          acc.model = d.response.model ?? acc.model
          acc.tokensIn = d.response.usage.input_tokens ?? acc.tokensIn
          acc.tokensOut = d.response.usage.output_tokens ?? acc.tokensOut
        }
      } else if (provider === "gemini") {
        if (d.modelVersion) acc.model = d.modelVersion
        if (d.usageMetadata) {
          acc.tokensIn = d.usageMetadata.promptTokenCount ?? acc.tokensIn
          acc.tokensOut = d.usageMetadata.candidatesTokenCount ?? acc.tokensOut
        }
      }
    },
    result: () => acc,
  }
}

/** Record metered usage from a proxied call. */
export async function meterUsage(agentId: string, provider: string, usage: Usage): Promise<number> {
  const cost = costUsd(usage.model, usage.tokensIn, usage.tokensOut)
  await db.tokenLog.create({
    data: {
      agentId,
      model: usage.model,
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      costUsd: cost,
      taskLabel: `gateway:${provider}`,
    },
  })
  return cost
}
