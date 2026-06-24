import { describe, it, expect } from "vitest"
import { costUsd, GATEWAY_PROVIDERS, makeStreamMeter, tokenBudgetUsd } from "../lib/gateway"

describe("costUsd — longest-prefix pricing match", () => {
  it("prices 1M in / 1M out for a known model", () => {
    // gpt-4o-mini = [0.15, 0.6] per 1M
    expect(costUsd("gpt-4o-mini", 1_000_000, 1_000_000)).toBe(0.75)
  })

  it("most-specific prefix wins over a shorter one", () => {
    // 'gpt-4o-mini' must NOT fall back to 'gpt-4o' (2.5/10)
    expect(costUsd("gpt-4o-mini", 1_000_000, 0)).toBe(0.15)
    expect(costUsd("gpt-4o", 1_000_000, 0)).toBe(2.5)
    // gemini-flash-lite beats gemini-flash beats gemini
    expect(costUsd("gemini-flash-lite", 1_000_000, 0)).toBe(0.0375)
    expect(costUsd("gemini-flash", 1_000_000, 0)).toBe(0.075)
  })

  it("is case-insensitive", () => {
    expect(costUsd("Claude-Opus-4", 1000, 1000)).toBe(costUsd("claude-opus-4", 1000, 1000))
  })

  it("returns 0 for an unknown model (never guesses a price)", () => {
    expect(costUsd("totally-unknown-model", 1_000_000, 1_000_000)).toBe(0)
  })

  it("computes a mixed in/out charge", () => {
    // claude-opus = [15, 75]; 1000 in + 1000 out = (15000 + 75000)/1e6 = 0.09
    expect(costUsd("claude-opus-4", 1000, 1000)).toBe(0.09)
  })
})

describe("GATEWAY_PROVIDERS.extract — per-provider usage shape", () => {
  it("anthropic input/output tokens", () => {
    const u = GATEWAY_PROVIDERS.anthropic.extract({ model: "claude-x", usage: { input_tokens: 10, output_tokens: 4 } }, "v1/messages")
    expect(u).toEqual({ model: "claude-x", tokensIn: 10, tokensOut: 4 })
  })

  it("openai prompt/completion tokens", () => {
    const u = GATEWAY_PROVIDERS.openai.extract({ model: "gpt-4o", usage: { prompt_tokens: 20, completion_tokens: 5 } }, "v1/chat/completions")
    expect(u).toEqual({ model: "gpt-4o", tokensIn: 20, tokensOut: 5 })
  })

  it("gemini usageMetadata, model from path when modelVersion absent", () => {
    const u = GATEWAY_PROVIDERS.gemini.extract({ usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3 } }, "v1beta/models/gemini-2.5-flash:generateContent")
    expect(u).toEqual({ model: "gemini-2.5-flash", tokensIn: 7, tokensOut: 3 })
  })

  it("returns null when there is no usage to meter", () => {
    expect(GATEWAY_PROVIDERS.anthropic.extract({ model: "claude-x" }, "x")).toBeNull()
    expect(GATEWAY_PROVIDERS.openai.extract({}, "x")).toBeNull()
    expect(GATEWAY_PROVIDERS.gemini.extract({}, "x")).toBeNull()
  })
})

describe("makeStreamMeter — accumulates SSE usage", () => {
  it("anthropic: input on message_start, final output on message_delta", () => {
    const m = makeStreamMeter("anthropic")
    m.feed({ type: "message_start", message: { model: "claude-x", usage: { input_tokens: 12, output_tokens: 1 } } })
    m.feed({ type: "message_delta", usage: { output_tokens: 48 } })
    expect(m.result()).toEqual({ model: "claude-x", tokensIn: 12, tokensOut: 48 })
  })

  it("openai: reads usage from the final chunk", () => {
    const m = makeStreamMeter("openai")
    m.feed({ model: "gpt-4o", usage: { prompt_tokens: 20, completion_tokens: 30 } })
    expect(m.result()).toEqual({ model: "gpt-4o", tokensIn: 20, tokensOut: 30 })
  })

  it("gemini: reads usageMetadata", () => {
    const m = makeStreamMeter("gemini")
    m.feed({ modelVersion: "gemini-2.5", usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 7 } })
    expect(m.result()).toEqual({ model: "gemini-2.5", tokensIn: 5, tokensOut: 7 })
  })
})

describe("tokenBudgetUsd — per-agent override > wallet policy > none", () => {
  const wallet = (cents: number | null) => ({ wallet: { policy: cents == null ? null : { dailyTokenBudgetUsd: cents } } })

  it("uses the per-agent override (cents→dollars)", () => {
    expect(tokenBudgetUsd({ id: "a", isActive: true, dailyTokenBudgetUsd: 5000, ...wallet(10000) })).toBe(50)
  })

  it("falls back to the wallet policy when no override", () => {
    expect(tokenBudgetUsd({ id: "a", isActive: true, dailyTokenBudgetUsd: null, ...wallet(10000) })).toBe(100)
  })

  it("is null (no enforcement) when neither is set", () => {
    expect(tokenBudgetUsd({ id: "a", isActive: true, dailyTokenBudgetUsd: null, ...wallet(null) })).toBeNull()
  })
})
