import { describe, it, expect, vi, beforeEach } from "vitest"

// SIM-2 sequential replay: decisions replay in chronological order with each
// agent's approved spend threaded forward, so an early would-denial frees
// budget for a later request — the cascade SIM-1 (as_recorded) holds constant.
const { dbMock } = vi.hoisted(() => ({
  dbMock: { agent: { findMany: vi.fn() }, authorizationRequest: { findMany: vi.fn() } },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))

import { runSimulation } from "../lib/simulationRun"
import { simulateEvidence } from "../lib/simulate"

// A full spend context as EVID-1 persists it (cents for limits). Candidate
// policy overlays daily budget + blocked categories; the rest comes from here.
function spendCtx(over: Record<string, unknown> = {}) {
  return {
    amountUsd: 60,
    amountCents: 6000,
    category: "software",
    blockedCategories: [] as string[],
    allowedCategories: [] as string[],
    perTxnMaxCents: 100_000,
    dailySpentUsd: 0,
    dailyBudgetCents: 10_000,
    monthlySpentUsd: 0,
    monthlyBudgetCents: null,
    autoApproveUnderCents: 1_000,
    escalateOverCents: 100_000,
    ...over,
  }
}
const evidence = (ctx: Record<string, unknown>) => ({ ladder: "spend", effect: "allow", rule_id: "ladder", ctx })
const row = (id: string, at: string, amountUsd: number, ctx: Record<string, unknown>) => ({
  id, createdAt: new Date(at), agentId: "a1", action: "purchase", merchant: "m",
  amountUsd, status: "approved", decisionContextJson: evidence(ctx),
})

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.agent.findMany.mockResolvedValue([{ id: "a1", name: "agent" }])
})

describe("sequential vs as_recorded", () => {
  // A (risky, blocked by candidate) → denied, spends nothing. B recorded that A
  // had spent $60, so under a $100 daily cap B is denied as_recorded — but
  // sequential knows A never spent, so B fits.
  const A = row("A", "2026-06-01T10:00:00Z", 60, spendCtx({ category: "risky", dailySpentUsd: 0 }))
  const B = row("B", "2026-06-01T11:00:00Z", 60, spendCtx({ category: "software", dailySpentUsd: 60 }))
  const policy = { daily_spend_budget_usd: 100, blocked_categories: ["risky"] }
  const start = new Date("2026-06-01T00:00:00Z")
  const end = new Date("2026-06-02T00:00:00Z")

  it("as_recorded denies B on the recorded $60 running total", async () => {
    dbMock.authorizationRequest.findMany.mockResolvedValue([A, B])
    const r = await runSimulation("w", policy, start, end, "as_recorded")
    expect(r.state).toBe("as_recorded")
    const bChange = r.changes.find((c) => c.id === "B")
    expect(bChange?.would).toMatchObject({ effect: "deny", code: "DAILY_BUDGET_EXCEEDED" })
  })

  it("sequential approves B because A's denial freed the budget", async () => {
    dbMock.authorizationRequest.findMany.mockResolvedValue([A, B])
    const r = await runSimulation("w", policy, start, end, "sequential")
    expect(r.state).toBe("sequential")
    // A flips to deny (category); B stays allow (its recorded effect), so B is
    // NOT a change but IS counted — the totals carry the real signal.
    expect(r.changes.find((c) => c.id === "A")?.would).toMatchObject({ effect: "deny", code: "CATEGORY_BLOCKED" })
    expect(r.changes.find((c) => c.id === "B")).toBeUndefined()
    expect(r.totals.would).toMatchObject({ allow: 1, deny: 1 }) // B allowed, A denied
    // Threaded approved spend = just B's $60 (A never accrued).
    expect(r.approved_spend_usd.would).toBe(60)
  })

  it("threads within a day but resets at the UTC boundary", async () => {
    // Two $60 approvals same day exhaust a $100 cap; the second is denied. The
    // next day, the counter resets and a third $60 fits again.
    const d1a = row("d1a", "2026-06-01T09:00:00Z", 60, spendCtx({ dailySpentUsd: 0 }))
    const d1b = row("d1b", "2026-06-01T10:00:00Z", 60, spendCtx({ dailySpentUsd: 0 }))
    const d2a = row("d2a", "2026-06-02T09:00:00Z", 60, spendCtx({ dailySpentUsd: 0 }))
    dbMock.authorizationRequest.findMany.mockResolvedValue([d1a, d1b, d2a])
    const r = await runSimulation("w", { daily_spend_budget_usd: 100 }, start, new Date("2026-06-03T00:00:00Z"), "sequential")
    // day1: first allows (0+60), second denies (60+60>100); day2: resets, allows.
    expect(r.totals.would).toMatchObject({ allow: 2, deny: 1 })
    expect(r.approved_spend_usd.would).toBe(120)
  })
})

describe("simulateEvidence budget override (the threading primitive)", () => {
  it("flips a spend from allow to deny when the threaded budget is higher", () => {
    const e = evidence(spendCtx({ dailySpentUsd: 0 })) as never
    const policy = { daily_spend_budget_usd: 100 }
    // As-recorded (no override): 0 + 60 ≤ 100 → allow.
    expect(simulateEvidence(e, policy)!.would.effect).toBe("allow")
    // Threaded to $60 already spent: 60 + 60 > 100 → deny.
    expect(simulateEvidence(e, policy, { dailySpentUsd: 60, monthlySpentUsd: 60 })!.would).toMatchObject({
      effect: "deny",
      code: "DAILY_BUDGET_EXCEEDED",
    })
  })
})
