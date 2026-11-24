import { describe, it, expect, vi } from "vitest"
import {
  CascadeBudgetExceeded,
  cascadeDailyWouldExceed,
  effectivePerTransactionMaxCents,
  inheritedTokenDefaults,
  reserveCascadeDailySpend,
  type CascadeTx,
  type WalletBudgetNode,
} from "../lib/cascadeBudget"

const node = (
  id: string,
  parentId: string | null,
  policy: WalletBudgetNode["policy"],
): WalletBudgetNode => ({ id, parentId, policy })

const uncapped = { perTransactionMaxUsd: 10_000, subtreeDailyCapUsd: null }
const capped = (cap: number, perTxn = 10_000) => ({ perTransactionMaxUsd: perTxn, subtreeDailyCapUsd: cap })

function txMock(overrides: Partial<CascadeTx> = {}): CascadeTx {
  return {
    wallet: { findUnique: vi.fn() },
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async () => [{ one: 0 }]),
    ...overrides,
  } as unknown as CascadeTx
}

describe("cascade budget helpers", () => {
  it("cascades per-transaction caps by taking the tightest ancestor cap", () => {
    const chain = [node("leaf", "parent", capped(5000, 20_000)), node("parent", null, capped(5000, 1500))]
    expect(effectivePerTransactionMaxCents(null, 20_000, chain)).toBe(1500)
    expect(effectivePerTransactionMaxCents(1200, 20_000, chain)).toBe(1200)
  })

  it("does not touch counters when no ancestor has a subtree cap", async () => {
    const tx = txMock()
    await reserveCascadeDailySpend(tx, "leaf", 1000, new Date("2026-07-01T12:00:00Z"), [
      node("leaf", "parent", uncapped),
      node("parent", null, uncapped),
    ])
    expect(tx.$executeRaw).not.toHaveBeenCalled()
  })

  it("checks only capped ancestors during simulation", async () => {
    const query = vi.fn(async () => [{ one: 1 }])
    const exceeded = await cascadeDailyWouldExceed(
      txMock({ $queryRaw: query as never }),
      "leaf",
      1000,
      new Date("2026-07-01T12:00:00Z"),
      [node("leaf", "parent", uncapped), node("parent", null, capped(5000))],
    )

    expect(exceeded).toBe(true)
    expect(query).toHaveBeenCalledTimes(1)
  })

  it("throws when a capped ancestor conditional increment fails", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
    const tx = txMock({ $executeRaw: execute as never })

    await expect(
      reserveCascadeDailySpend(tx, "leaf", 10_000, new Date("2026-07-01T12:00:00Z"), [
        node("leaf", "parent", uncapped),
        node("parent", null, capped(5000)),
      ]),
    ).rejects.toBeInstanceOf(CascadeBudgetExceeded)
  })
})

describe("inheritedTokenDefaults: a group with no policy takes the nearest policy above", () => {
  const withModel = (daily: number, monthly: number | null = null) => ({ ...uncapped, dailyTokenBudgetUsd: daily, monthlyTokenBudgetUsd: monthly })

  it("uses the wallet's own policy when it has one, even if the parent's is lower", () => {
    const chain = [node("team", "org", withModel(5000)), node("org", null, withModel(1000, 20_000))]
    expect(inheritedTokenDefaults(chain)).toEqual({ dailyTokenBudgetUsd: 5000, monthlyTokenBudgetUsd: null })
  })

  it("takes daily and monthly from the nearest wallet above when the group has no policy", () => {
    const chain = [node("team", "dept", null), node("dept", "org", withModel(1000, 20_000)), node("org", null, withModel(9000))]
    expect(inheritedTokenDefaults(chain)).toEqual({ dailyTokenBudgetUsd: 1000, monthlyTokenBudgetUsd: 20_000 })
  })

  it("skips several wallets with no policy", () => {
    const chain = [node("team", "dept", null), node("dept", "org", null), node("org", null, withModel(700))]
    expect(inheritedTokenDefaults(chain)?.dailyTokenBudgetUsd).toBe(700)
  })

  it("is null when no wallet in the chain has a policy", () => {
    expect(inheritedTokenDefaults([node("team", "org", null), node("org", null, null)])).toBeNull()
    expect(inheritedTokenDefaults([])).toBeNull()
  })
})
