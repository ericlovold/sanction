import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { hashApiKey } from "../lib/apiKey"

// Reallocation (REALLOC-1): moving budget between sibling pools is atomic,
// subtree-authorized, refuses to overdraw the source, and leaves an audit row.

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    wallet: { findUnique: vi.fn(), findMany: vi.fn() },
    policy: { findUnique: vi.fn(), upsert: vi.fn() },
    policyRevision: { create: vi.fn() },
    budgetReallocation: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("@/lib/poolAccess", () => ({ walletSubtreeIds: vi.fn(async () => ["wallet_1", "pool_a", "pool_b"]) }))

import { POST as reallocate } from "../app/api/v1/wallets/reallocate/route"

const SK = "sk_testmanagementkey"
const WID = "wallet_1"
const OWNER_WALLET = { id: WID, name: "Acme", parentId: null, mgmtKeyHash: hashApiKey(SK), mgmtKeyPrefix: "sk_testmana" }

function req(body: unknown, headers: Record<string, string> = { "x-mgmt-key": SK }) {
  return new NextRequest("https://test.local/api/v1/wallets/reallocate", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.wallet.findUnique.mockResolvedValue(OWNER_WALLET)
  dbMock.$transaction.mockImplementation(async (fn: (tx: typeof dbMock) => unknown) => fn(dbMock))
  dbMock.policy.upsert.mockImplementation(async ({ where, update }: { where: { walletId: string }; update: Record<string, unknown> }) => ({
    id: `pol_${where.walletId}`,
    walletId: where.walletId,
    currentRevision: 2,
    ...update,
  }))
  dbMock.budgetReallocation.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "move_1", ...data }))
})

describe("POST /v1/wallets/reallocate", () => {
  it("owner-only, and both pools must be in the caller's subtree", async () => {
    expect(
      (await reallocate(req({ wallet_id: WID, from_wallet_id: "pool_a", to_wallet_id: "pool_b", amount_usd: 10 }, { "x-mgmt-key": "sk_wrong" }))).status,
    ).toBe(401)
    expect(
      (await reallocate(req({ wallet_id: WID, from_wallet_id: "pool_a", to_wallet_id: "outsider", amount_usd: 10 }))).status,
    ).toBe(403)
  })

  it("refuses to overdraw the source cap", async () => {
    dbMock.policy.findUnique
      .mockResolvedValueOnce({ subtreeDailyCapUsd: 500 }) // from: $5
      .mockResolvedValueOnce({ subtreeDailyCapUsd: 0 })
    const res = await reallocate(req({ wallet_id: WID, from_wallet_id: "pool_a", to_wallet_id: "pool_b", amount_usd: 10 }))
    expect(res.status).toBe(422)
    expect(dbMock.policy.upsert).not.toHaveBeenCalled()
    expect(dbMock.budgetReallocation.create).not.toHaveBeenCalled()
  })

  it("moves the cap, writes both revisions and one audit row", async () => {
    dbMock.policy.findUnique
      .mockResolvedValueOnce({ subtreeDailyCapUsd: 12_000 }) // from: $120
      .mockResolvedValueOnce({ subtreeDailyCapUsd: 3_000 }) // to: $30
    const res = await reallocate(
      req({ wallet_id: WID, from_wallet_id: "pool_a", to_wallet_id: "pool_b", amount_usd: 50, reason: "shift to efficient channel" }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.from.subtree_daily_cap_usd).toBe(70)
    expect(body.to.subtree_daily_cap_usd).toBe(80)
    // both cap writes went through the revisioned path (EVID-1)
    expect(dbMock.policy.upsert).toHaveBeenCalledTimes(2)
    expect(dbMock.policyRevision.create).toHaveBeenCalledTimes(2)
    const audit = dbMock.budgetReallocation.create.mock.calls[0][0].data
    expect(audit).toMatchObject({ fromWalletId: "pool_a", toWalletId: "pool_b", amountCents: 5000, actor: "api" })
  })
})
