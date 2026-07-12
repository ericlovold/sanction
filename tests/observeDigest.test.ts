import { describe, expect, it } from "vitest"
import { buildObserveDigest, emptyTally } from "../lib/observeDigest"

// C2: the observe digest folds persisted observed rows into the per-pool
// "here is what enforcement would have done" story. Pure over its inputs.

const agentToWallet = new Map([
  ["agent_a", "pool_1"],
  ["agent_b", "pool_1"],
  ["agent_c", "pool_2"],
])

const row = (over: Partial<{ agentId: string; amountUsd: number; status: string; decisionNote: string | null }>) => ({
  agentId: "agent_a",
  amountUsd: 10,
  status: "approved",
  decisionNote: null as string | null,
  ...over,
})

describe("buildObserveDigest", () => {
  it("tallies per wallet by would-be status and sums the money that would have been stopped", () => {
    const digest = buildObserveDigest(
      [
        row({ status: "approved", amountUsd: 5 }),
        row({ status: "denied", decisionNote: "Category 'gambling' is blocked", amountUsd: 40 }),
        row({ agentId: "agent_b", status: "denied", decisionNote: "Exceeds per-transaction maximum", amountUsd: 200 }),
        row({ agentId: "agent_b", status: "escalated", decisionNote: "Amount over auto-approve threshold", amountUsd: 60 }),
        row({ agentId: "agent_c", status: "approved", amountUsd: 3 }),
      ],
      agentToWallet,
    )

    const pool1 = digest.perWallet.get("pool_1")
    expect(pool1).toMatchObject({ total: 4, wouldAllow: 1, wouldDeny: 2, wouldEscalate: 1, deniedUsd: 240, escalatedUsd: 60 })
    expect(digest.perWallet.get("pool_2")).toMatchObject({ total: 1, wouldAllow: 1, wouldDeny: 0 })
    expect(digest.totals).toMatchObject({ total: 5, wouldAllow: 2, wouldDeny: 2, wouldEscalate: 1, deniedUsd: 240, escalatedUsd: 60 })
  })

  it("derives stable decision codes for the flag list, most frequent first", () => {
    const digest = buildObserveDigest(
      [
        row({ status: "denied", decisionNote: "Category 'gambling' is blocked" }),
        row({ status: "denied", decisionNote: "Category 'weapons' is blocked" }),
        row({ status: "escalated", decisionNote: "Amount over auto-approve threshold" }),
        row({ status: "approved" }),
      ],
      agentToWallet,
    )
    expect(digest.topCodes).toEqual([
      { code: "CATEGORY_BLOCKED", count: 2 },
      { code: "ESCALATION_REQUIRED", count: 1 },
    ])
  })

  it("approvals carry no code — a clean week produces an empty flag list", () => {
    const digest = buildObserveDigest([row({}), row({ agentId: "agent_b" })], agentToWallet)
    expect(digest.topCodes).toEqual([])
    expect(digest.totals.wouldAllow).toBe(2)
  })

  it("rows from agents outside the map are skipped, not misattributed", () => {
    const digest = buildObserveDigest([row({ agentId: "agent_gone", status: "denied" })], agentToWallet)
    expect(digest.totals).toEqual(emptyTally())
    expect(digest.perWallet.size).toBe(0)
  })
})
