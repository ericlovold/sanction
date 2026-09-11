import { describe, it, expect } from "vitest"
import { normalizeUsage } from "../lib/usageObservation"

export function logs(attrs: Record<string, unknown>, time = "1789142400000000000") {
  return { resourceLogs: [{ resource: { attributes: [] }, scopeLogs: [{ logRecords: [{ timeUnixNano: time, body: null,
    attributes: Object.entries(attrs).map(([key, value]) => ({ key, value: typeof value === "number" ? { doubleValue: value } : { stringValue: value } })),
  }] }] }] }
}
const now = new Date("2026-09-12T00:00:00Z")
describe("usage observation normalization", () => {
  it("retains usage and no prompt/output metadata; retry identity is stable", () => {
    const data = logs({ "event.name": "api_request", "session.id": "a", model: "claude", input_tokens: 10, output_tokens: 3, cache_read_tokens: 8, cost_usd: "0.02", prompt: "SECRET", tool_output: "SECRET" })
    const a = normalizeUsage("claude-code", data, now)
    expect(a.events[0]).toMatchObject({ source: "claude-code", tokensIn: 10, tokensOut: 3, cacheReadTokens: 8, estimatedCostUsd: 0.02 })
    expect(JSON.stringify(a)).not.toContain("SECRET")
    expect(normalizeUsage("claude-code", data, new Date(now.getTime() + 10000)).events[0].eventId).toBe(a.events[0].eventId)
  })
  it("records Codex completed usage without inventing a price", () => {
    const result = normalizeUsage("codex", logs({ "event.name": "codex.sse_event", "conversation.id": "b", "event.kind": "response.completed", "event.timestamp": "2026-09-11T16:00:00Z", input_token_count: "42", output_token_count: 4, cached_token_count: 20 }, "0"), now)
    expect(result.events[0]).toMatchObject({ tokensIn: 42, tokensOut: 4, cacheReadTokens: 20, estimatedCostUsd: null })
  })
  it("ignores intermediate stream chunks, wrong sources, and unattributed events", () => {
    for (const attrs of [
      { "event.name": "codex.sse_event", "conversation.id": "b", kind: "response.output_text.delta" },
      { "event.name": "api_request", "session.id": "a" },
      { "event.name": "codex.user_prompt" },
    ]) expect(normalizeUsage("codex", logs(attrs), now)).toEqual({ events: [], ignored: 1 })
  })
  it("keeps activity but does not interpret it as a priced model call", () => {
    expect(normalizeUsage("codex", logs({ "event.name": "codex.tool_result", "conversation.id": "a", input_token_count: 100 }), now).events[0]).toMatchObject({ eventName: "tool_activity", tokensIn: null })
    expect(normalizeUsage("claude-code", logs({ "event.name": "user_prompt", "session.id": "a" }), now).events[0].eventName).toBe("session_activity")
  })
  it("rejects malformed, negative, oversized, and future usage", () => {
    for (const n of [-1, "NaN", 1.5, 3_000_000_000]) expect(() => normalizeUsage("claude-code", logs({ "event.name": "api_request", "session.id": "a", input_tokens: n }), now)).toThrow()
    for (const n of [-1, "NaN", 2_000_000]) expect(() => normalizeUsage("claude-code", logs({ "event.name": "api_request", "session.id": "a", cost_usd: n }), now)).toThrow()
    expect(() => normalizeUsage("codex", {}, now)).toThrow()
    expect(() => normalizeUsage("codex", logs({ "event.name": "codex.user_prompt", "session.id": "a" }, "1999999999999999999"), now)).toThrow()
  })
})
