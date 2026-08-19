import { describe, it, expect } from "vitest"
import { costUsd, GATEWAY_PROVIDERS, makeStreamMeter, tokenBudgetUsd, forceStreamUsage } from "../lib/gateway"

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

  it("meters an unknown model at the conservative fallback, never as free", () => {
    // Fail closed on the money path: an unpriced model bills at the most
    // expensive rate in the table (currently o1 at 15/60) instead of
    // bypassing every budget. Derived, so it tracks the table.
    expect(costUsd("totally-unknown-model", 1_000_000, 1_000_000)).toBe(75)
    expect(costUsd("gpt-5.2-turbo", 1_000_000, 0)).toBe(15)
  })

  it("prices the current Claude tiers", () => {
    // Verified against the Claude pricing reference 2026-08-01
    expect(costUsd("claude-fable-5", 1_000_000, 1_000_000)).toBe(60) // 10 + 50
    expect(costUsd("claude-opus-5", 1_000_000, 1_000_000)).toBe(30) // 5 + 25
    expect(costUsd("claude-sonnet-5", 1_000_000, 1_000_000)).toBe(18) // 3 + 15
    expect(costUsd("claude-haiku-4-5", 1_000_000, 1_000_000)).toBe(6) // 1 + 5
  })

  it("computes a mixed in/out charge", () => {
    // claude-opus = [5, 25]; 1000 in + 1000 out = (5000 + 25000)/1e6 = 0.03
    expect(costUsd("claude-opus-4", 1000, 1000)).toBe(0.03)
  })
})

describe("GATEWAY_PROVIDERS.extract — per-provider usage shape", () => {
  it("anthropic input/output tokens", () => {
    const u = GATEWAY_PROVIDERS.anthropic.extract({ model: "claude-x", usage: { input_tokens: 10, output_tokens: 4 } }, "v1/messages")
    expect(u).toEqual({ model: "claude-x", tokensIn: 10, tokensOut: 4 })
  })

  it("openai prompt/completion tokens (Chat Completions)", () => {
    const u = GATEWAY_PROVIDERS.openai.extract({ model: "gpt-4o", usage: { prompt_tokens: 20, completion_tokens: 5 } }, "v1/chat/completions")
    expect(u).toEqual({ model: "gpt-4o", tokensIn: 20, tokensOut: 5 })
  })

  it("openai input/output tokens (Responses API — the AI SDK native default)", () => {
    const u = GATEWAY_PROVIDERS.openai.extract({ model: "gpt-5", usage: { input_tokens: 12, output_tokens: 8 } }, "v1/responses")
    expect(u).toEqual({ model: "gpt-5", tokensIn: 12, tokensOut: 8 })
  })

  it("perplexity prompt/completion tokens (OpenAI-compatible shape)", () => {
    const u = GATEWAY_PROVIDERS.perplexity.extract({ model: "sonar-pro", usage: { prompt_tokens: 30, completion_tokens: 11 } }, "chat/completions")
    expect(u).toEqual({ model: "sonar-pro", tokensIn: 30, tokensOut: 11 })
  })

  it("gemini usageMetadata, model from path when modelVersion absent", () => {
    const u = GATEWAY_PROVIDERS.gemini.extract({ usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3 } }, "v1beta/models/gemini-2.5-flash:generateContent")
    expect(u).toEqual({ model: "gemini-2.5-flash", tokensIn: 7, tokensOut: 3 })
  })

  it("returns null when there is no usage to meter", () => {
    expect(GATEWAY_PROVIDERS.anthropic.extract({ model: "claude-x" }, "x")).toBeNull()
    expect(GATEWAY_PROVIDERS.openai.extract({}, "x")).toBeNull()
    expect(GATEWAY_PROVIDERS.gemini.extract({}, "x")).toBeNull()
    expect(GATEWAY_PROVIDERS.perplexity.extract({ model: "sonar" }, "x")).toBeNull()
  })
})

describe("makeStreamMeter — accumulates SSE usage", () => {
  it("anthropic: input on message_start, final output on message_delta", () => {
    const m = makeStreamMeter("anthropic")
    m.feed({ type: "message_start", message: { model: "claude-x", usage: { input_tokens: 12, output_tokens: 1 } } })
    m.feed({ type: "message_delta", usage: { output_tokens: 48 } })
    expect(m.result()).toEqual({ model: "claude-x", tokensIn: 12, tokensOut: 48 })
  })

  it("openai: reads usage from the final chunk (Chat Completions)", () => {
    const m = makeStreamMeter("openai")
    m.feed({ model: "gpt-4o", usage: { prompt_tokens: 20, completion_tokens: 30 } })
    expect(m.result()).toEqual({ model: "gpt-4o", tokensIn: 20, tokensOut: 30 })
  })

  it("openai: reads nested usage on the terminal event (Responses API)", () => {
    const m = makeStreamMeter("openai")
    m.feed({ type: "response.completed", response: { model: "gpt-5", usage: { input_tokens: 30, output_tokens: 12 } } })
    expect(m.result()).toEqual({ model: "gpt-5", tokensIn: 30, tokensOut: 12 })
  })

  it("perplexity: reads usage from stream chunks like openai", () => {
    const m = makeStreamMeter("perplexity")
    m.feed({ model: "sonar-pro", usage: { prompt_tokens: 40, completion_tokens: 9 } })
    expect(m.result()).toEqual({ model: "sonar-pro", tokensIn: 40, tokensOut: 9 })
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
    expect(tokenBudgetUsd({ id: "a", walletId: "w", isActive: true, dailyTokenBudgetUsd: 5000, ...wallet(10000) })).toBe(50)
  })

  it("falls back to the wallet policy when no override", () => {
    expect(tokenBudgetUsd({ id: "a", walletId: "w", isActive: true, dailyTokenBudgetUsd: null, ...wallet(10000) })).toBe(100)
  })

  it("is null (no enforcement) when neither is set", () => {
    expect(tokenBudgetUsd({ id: "a", walletId: "w", isActive: true, dailyTokenBudgetUsd: null, ...wallet(null) })).toBeNull()
  })
})

describe("forceStreamUsage — metering is not the caller's choice", () => {
  const decode = (b: ArrayBuffer | undefined) => JSON.parse(new TextDecoder().decode(b!))
  const encode = (o: unknown) => new TextEncoder().encode(JSON.stringify(o)).buffer as ArrayBuffer

  it("adds include_usage to an OpenAI stream that omitted it (the bypass)", () => {
    const out = forceStreamUsage("openai", encode({ model: "gpt-4o", stream: true }))
    expect(decode(out).stream_options).toEqual({ include_usage: true })
  })

  it("preserves other stream_options while forcing include_usage", () => {
    const out = forceStreamUsage("openai", encode({ stream: true, stream_options: { foo: 1 } }))
    expect(decode(out).stream_options).toEqual({ foo: 1, include_usage: true })
  })

  it("leaves non-streaming requests untouched", () => {
    const body = encode({ model: "gpt-4o", stream: false })
    expect(forceStreamUsage("openai", body)).toBe(body)
  })

  it("leaves providers that stream usage by default untouched", () => {
    const body = encode({ stream: true })
    expect(forceStreamUsage("anthropic", body)).toBe(body)
    expect(forceStreamUsage("gemini", body)).toBe(body)
  })

  it("returns unparseable or empty bodies unchanged rather than corrupting them", () => {
    const junk = new TextEncoder().encode("not json").buffer as ArrayBuffer
    expect(forceStreamUsage("openai", junk)).toBe(junk)
    expect(forceStreamUsage("openai", undefined)).toBeUndefined()
    const arr = encode([1, 2, 3])
    expect(forceStreamUsage("openai", arr)).toBe(arr)
  })
})
