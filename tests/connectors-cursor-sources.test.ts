import { describe, expect, it, vi } from "vitest"
import { cursorDay, cursorSources, cursorSourceUrl } from "@/lib/connectors/cursorSources"

const mocks = vi.hoisted(() => {
  const usageFact = { groupBy: vi.fn(), count: vi.fn() }
  return { usageFact, withTenant: vi.fn((_id: string, fn: (tx: unknown) => unknown) => fn({ usageFact })) }
})
vi.mock("@/lib/rls", () => ({ withTenant: mocks.withTenant }))

describe("Cursor source day", () => {
  const now = new Date("2024-03-01T00:00:01Z")
  it("links exact provider IDs on the fixed Cursor origin", () => {
    expect(cursorSourceUrl("Automation", "abc-123")).toBe("https://cursor.com/automations/abc-123")
    expect(cursorSourceUrl("Cloud agent", "bc_a1")).toBe("https://cursor.com/agents/bc_a1")
    expect(cursorSourceUrl("Conversation", "abc-123")).toBeNull()
    expect(cursorSourceUrl("Automation", "..")).toBeNull()
    expect(cursorSourceUrl("Automation", "a/b")).toBeNull()
  })
  it("defaults to today's UTC date and accepts leap days", () => {
    expect(cursorDay(undefined, now)?.toISOString()).toBe("2024-03-01T00:00:00.000Z")
    expect(cursorDay("2024-02-29", now)?.toISOString()).toBe("2024-02-29T00:00:00.000Z")
  })
  it.each([["2023-02-29"], ["2024-02-30"], ["2024-03-02"], ["0000-01-01"], ["2024-3-1"], ["abc"], [["2024-02-01", "2024-02-02"]]])(
    "rejects invalid, future and ambiguous dates", (input) => expect(cursorDay(input, now)).toBeNull(),
  )
  it("groups exact IDs by precedence and retains unreported requests in the selected wallet and UTC day", async () => {
    const all = { inputTokens: BigInt(3), outputTokens: BigInt(4), cacheReadTokens: BigInt(7), cacheWriteTokens: BigInt(1), requests: 2, tokenReportedRequests: 1 }
    const zero = { inputTokens: BigInt(0), outputTokens: BigInt(0), cacheReadTokens: BigInt(0), cacheWriteTokens: BigInt(0), requests: 1, tokenReportedRequests: 0 }
    mocks.usageFact.count.mockResolvedValue(1)
    mocks.usageFact.groupBy.mockResolvedValue([
      { automationRef: "a1", sessionRef: "conv1", _sum: all },
      { automationRef: "a1", sessionRef: "conv2", _sum: all },
      { automationRef: "cloud-agent:a1", sessionRef: "a1", _sum: all },
      { automationRef: null, sessionRef: "a1", _sum: all },
      { automationRef: null, sessionRef: null, _sum: zero },
    ])
    const start = cursorDay("2024-02-29", now)!
    const data = await cursorSources("wallet1", start)
    expect(mocks.withTenant).toHaveBeenCalledWith("wallet1", expect.any(Function))
    const where = { walletId: "wallet1", provider: "cursor", bucketStart: { gte: start, lt: new Date("2024-03-01T00:00:00Z") } }
    expect(mocks.usageFact.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { ...where, tokenReportedRequests: { not: null } } }))
    expect(mocks.usageFact.count).toHaveBeenCalledWith({ where: { ...where, tokenReportedRequests: null } })
    expect(data.hasLegacy).toBe(true)
    expect(data.rows).toEqual([
      { kind: "Automation", id: "a1", tokens: BigInt(30), cached: BigInt(14), requests: 4, reported: 2 },
      { kind: "Cloud agent", id: "a1", tokens: BigInt(15), cached: BigInt(7), requests: 2, reported: 1 },
      { kind: "Conversation", id: "a1", tokens: BigInt(15), cached: BigInt(7), requests: 2, reported: 1 },
      { kind: "Unattributed", id: null, tokens: BigInt(0), cached: BigInt(0), requests: 1, reported: 0 },
    ])
  })
})
