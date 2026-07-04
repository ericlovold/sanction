import { describe, it, expect, vi, beforeEach } from "vitest"

// db is mocked: applyPolicyUpdate's value is the validation + dollars->cents math
// that runs *before* the upsert. We capture the upsert args to assert the math.
const { upsert, revisionCreate } = vi.hoisted(() => ({ upsert: vi.fn(), revisionCreate: vi.fn() }))
vi.mock("../lib/db", () => ({
  db: {
    policy: { upsert },
    policyRevision: { create: revisionCreate },
    // upsertPolicyWithRevision runs in a transaction; hand it the same mocks.
    $transaction: (fn: (tx: unknown) => unknown) => fn({ policy: { upsert }, policyRevision: { create: revisionCreate } }),
  },
}))

import { applyPolicyUpdate, policyToDollars } from "../lib/policy"

const ROW = {
  dailyTokenBudgetUsd: 0,
  dailySpendBudgetUsd: 0,
  monthlySpendBudgetUsd: null,
  subtreeDailyCapUsd: null,
  perTransactionMaxUsd: 0,
  autoApproveUnderUsd: 0,
  escalateOverUsd: 0,
  allowedCategories: [] as string[],
  blockedCategories: [] as string[],
  allowedTools: [] as string[],
  blockedTools: [] as string[],
  escalateTools: [] as string[],
  escalationTimeoutMins: 0,
  escalationTimeoutAction: "deny",
}

beforeEach(() => {
  upsert.mockReset()
  upsert.mockImplementation(async ({ update, create }: { update?: object; create?: object }) => ({ ...ROW, ...(update ?? create) }))
})

describe("applyPolicyUpdate — validation + dollars→cents", () => {
  it("rejects invalid input without touching the db", async () => {
    const r = await applyPolicyUpdate("w1", { daily_spend_budget_usd: -5 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe("Invalid policy")
    expect(upsert).not.toHaveBeenCalled()
  })

  it("rejects an empty update as a no-op", async () => {
    const r = await applyPolicyUpdate("w1", {})
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe("No fields to update")
    expect(upsert).not.toHaveBeenCalled()
  })

  it("converts dollars to cents on the way in", async () => {
    await applyPolicyUpdate("w1", { daily_spend_budget_usd: 50, subtree_daily_cap_usd: 500, per_transaction_max_usd: 19.99 })
    const arg = upsert.mock.calls[0][0]
    expect(arg.where).toEqual({ walletId: "w1" })
    expect(arg.update.dailySpendBudgetUsd).toBe(5000)
    expect(arg.update.subtreeDailyCapUsd).toBe(50000)
    expect(arg.update.perTransactionMaxUsd).toBe(1999) // 19.99 → 1999, no float drift
  })

  it("clears the optional subtree cap with null", async () => {
    await applyPolicyUpdate("w1", { subtree_daily_cap_usd: null })
    expect(upsert.mock.calls[0][0].update.subtreeDailyCapUsd).toBeNull()
  })

  it("converts the optional monthly cap dollars→cents, and clears it with null", async () => {
    await applyPolicyUpdate("w1", { monthly_spend_budget_usd: 800 })
    expect(upsert.mock.calls[0][0].update.monthlySpendBudgetUsd).toBe(80000)
    upsert.mockClear()
    await applyPolicyUpdate("w1", { monthly_spend_budget_usd: null })
    expect(upsert.mock.calls[0][0].update.monthlySpendBudgetUsd).toBeNull()
  })

  it("is partial — only sent fields are written", async () => {
    await applyPolicyUpdate("w1", { escalate_over_usd: 25 })
    const update = upsert.mock.calls[0][0].update
    // currentRevision rides every update (EVID-1 revision bump)
    expect(Object.keys(update)).toEqual(["escalateOverUsd", "currentRevision"])
    expect(update.escalateOverUsd).toBe(2500)
  })

  it("normalizes categories (trim + lowercase) via the schema", async () => {
    await applyPolicyUpdate("w1", { blocked_categories: ["  Gambling ", "CRYPTO"] })
    expect(upsert.mock.calls[0][0].update.blockedCategories).toEqual(["gambling", "crypto"])
  })

  it("returns the policy in dollars", async () => {
    const r = await applyPolicyUpdate("w1", { daily_spend_budget_usd: 50 })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.policy.daily_spend_budget_usd).toBe(50)
  })
})

describe("policyToDollars — cents→dollars round-trip", () => {
  it("divides every monetary field by 100 and passes through the rest", () => {
    const d = policyToDollars({
      ...ROW,
      dailyTokenBudgetUsd: 10000,
      dailySpendBudgetUsd: 5000,
      monthlySpendBudgetUsd: 80000,
      subtreeDailyCapUsd: 25000,
      perTransactionMaxUsd: 1999,
      autoApproveUnderUsd: 500,
      escalateOverUsd: 2500,
      allowedCategories: ["software"],
      blockedCategories: ["gambling"],
      escalationTimeoutMins: 60,
      escalationTimeoutAction: "approve",
    })
    expect(d.daily_token_budget_usd).toBe(100)
    expect(d.daily_spend_budget_usd).toBe(50)
    expect(d.monthly_spend_budget_usd).toBe(800)
    expect(d.subtree_daily_cap_usd).toBe(250)
    expect(d.per_transaction_max_usd).toBe(19.99)
    expect(d.auto_approve_under_usd).toBe(5)
    expect(d.escalate_over_usd).toBe(25)
    expect(d.allowed_categories).toEqual(["software"])
    expect(d.blocked_categories).toEqual(["gambling"])
    expect(d.escalation_timeout_mins).toBe(60)
    expect(d.escalation_timeout_action).toBe("approve")
  })
})

describe("upsertPolicyWithRevision (EVID-1)", () => {
  it("writes an immutable revision snapshot alongside every mutation", async () => {
    revisionCreate.mockClear()
    upsert.mockResolvedValue({ ...ROW, escalateOverUsd: 2500, id: "pol_1", walletId: "w1", currentRevision: 4, updatedAt: new Date() })
    await applyPolicyUpdate("w1", { escalate_over_usd: 25 })
    expect(revisionCreate).toHaveBeenCalledTimes(1)
    const arg = revisionCreate.mock.calls[0][0].data
    expect(arg.policyId).toBe("pol_1")
    expect(arg.revision).toBe(4)
    // The snapshot carries the policy fields but never the mutable envelope.
    expect(arg.snapshotJson.escalateOverUsd).toBe(2500)
    expect(arg.snapshotJson.id).toBeUndefined()
    expect(arg.snapshotJson.currentRevision).toBeUndefined()
  })
})
