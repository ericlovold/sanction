import { describe, it, expect, vi, beforeEach } from "vitest"

// lib/approvals.ts resolution machinery — the owner-decision path that turns a
// PendingApproval into a grant + a settled request. Complements approvals.test.ts
// (timeout math) with the resolution flows: approve mints a grant, reject
// doesn't, double-resolution 409s, expiry settles fail-closed (or approve, per
// policy), the legacy request_id fallback, and inbox listing that sweeps
// expired items. All against a mocked Prisma client; the DB e2e proves the loop.
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    pendingApproval: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    authorizationRequest: { findUnique: vi.fn(), updateMany: vi.fn() },
    grant: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("next/server", async (orig) => {
  const mod = await orig<typeof import("next/server")>()
  return { ...mod, after: () => {} }
})
vi.mock("@/lib/webhooks", () => ({ deliverEvent: vi.fn(async () => {}), APPROVE_URL: "https://test.local/approve", approveUrlFor: (id?: string) => `https://test.local/approve${id ? `?review=${encodeURIComponent(id)}` : ""}` }))

import { resolveApproval, listPendingApprovals } from "../lib/approvals"

const WID = "wallet_1"
const AID = "agent_1"

function pendingApproval(overrides: Record<string, unknown> = {}) {
  return {
    id: "pa_1",
    walletId: WID,
    agentId: AID,
    actionType: "spend.purchase",
    status: "pending",
    subjectJson: { agent_id: AID, agent_name: "tenet" },
    resourceJson: { kind: "spend", action: "purchase", amount_usd: 60, merchant: "Vendor", category: "software", description: null },
    constraintsJson: { one_use: true, grant_ttl_mins: 15, timeout_mins: 0, timeout_action: "deny" },
    sourceType: "authorization_request",
    sourceId: "req_1",
    expiresAt: null,
    createdAt: new Date(),
    agent: { name: "tenet" },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.$transaction.mockImplementation(async (fn: (tx: typeof dbMock) => unknown) => fn(dbMock))
  dbMock.pendingApproval.updateMany.mockResolvedValue({ count: 1 })
  dbMock.pendingApproval.findUnique.mockImplementation(async () => ({ ...pendingApproval(), status: "approved", resolvedAt: new Date(), resolutionNote: "Approved by owner" }))
  dbMock.grant.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "grant_1", ...data }))
  dbMock.authorizationRequest.updateMany.mockResolvedValue({ count: 1 })
  dbMock.authorizationRequest.findUnique.mockResolvedValue({ id: "req_1", status: "approved", decidedAt: new Date(), decisionNote: "Approved by owner" })
})

describe("resolveApproval — the owner decision", () => {
  it("approve: resolves the approval, mints a grant carrying the approved resource, settles the source request", async () => {
    dbMock.pendingApproval.findFirst.mockResolvedValue(pendingApproval())
    const result = await resolveApproval(WID, "pa_1", "approve")
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("unreachable")

    const grantData = dbMock.grant.create.mock.calls[0][0].data
    expect(grantData).toMatchObject({
      walletId: WID,
      agentId: AID,
      actionType: "spend.purchase",
      issuedFromApprovalId: "pa_1",
      sourceId: "req_1",
    })
    // grant TTL comes from the approval's constraints (15 min here)
    const ttlMs = (grantData.expiresAt as Date).getTime() - Date.now()
    expect(ttlMs).toBeGreaterThan(14 * 60_000)
    expect(ttlMs).toBeLessThanOrEqual(15 * 60_000 + 1_000)
    // the source AuthorizationRequest flips to approved
    expect(dbMock.authorizationRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "req_1", status: "escalated" }) }),
    )
  })

  it("reject: resolves without minting any grant, and the source request is denied", async () => {
    dbMock.pendingApproval.findFirst.mockResolvedValue(pendingApproval())
    dbMock.pendingApproval.findUnique.mockResolvedValue({ ...pendingApproval(), status: "denied", resolvedAt: new Date(), resolutionNote: "Rejected by owner" })
    const result = await resolveApproval(WID, "pa_1", "reject")
    expect(result.ok).toBe(true)
    expect(dbMock.grant.create).not.toHaveBeenCalled()
    expect(dbMock.authorizationRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "denied" }) }),
    )
  })

  it("finds the approval by source request_id too (legacy clients)", async () => {
    dbMock.pendingApproval.findFirst.mockResolvedValue(pendingApproval())
    const result = await resolveApproval(WID, "req_1", "approve")
    expect(result.ok).toBe(true)
    const where = dbMock.pendingApproval.findFirst.mock.calls[0][0].where
    expect(where.OR).toEqual([
      { id: "req_1" },
      { sourceType: "authorization_request", sourceId: "req_1" },
    ])
  })

  it("409s a second resolution of the same approval", async () => {
    dbMock.pendingApproval.findFirst.mockResolvedValue(pendingApproval({ status: "approved" }))
    const result = await resolveApproval(WID, "pa_1", "approve")
    expect(result).toMatchObject({ ok: false, status: 409 })
  })

  it("409s when a concurrent writer wins the guarded update (race lost)", async () => {
    dbMock.pendingApproval.findFirst.mockResolvedValue(pendingApproval())
    dbMock.pendingApproval.updateMany.mockResolvedValue({ count: 0 })
    const result = await resolveApproval(WID, "pa_1", "approve")
    expect(result).toMatchObject({ ok: false, status: 409 })
    expect(dbMock.grant.create).not.toHaveBeenCalled()
  })

  it("an expired approval settles (fail-closed deny) instead of resolving — 409 to the caller", async () => {
    dbMock.pendingApproval.findFirst.mockResolvedValue(
      pendingApproval({ expiresAt: new Date(Date.now() - 60_000), constraintsJson: { grant_ttl_mins: 15, timeout_mins: 1, timeout_action: "deny" } }),
    )
    const result = await resolveApproval(WID, "pa_1", "approve")
    expect(result).toMatchObject({ ok: false, error: "Approval expired", status: 409 })
    // the sweep marks the approval expired and denies the source request
    expect(dbMock.pendingApproval.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "expired", resolvedBy: "policy_timeout" }) }),
    )
    expect(dbMock.authorizationRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "denied" }) }),
    )
  })

  it("an expired approval with timeout_action approve settles the source to approved", async () => {
    dbMock.pendingApproval.findFirst.mockResolvedValue(
      pendingApproval({ expiresAt: new Date(Date.now() - 60_000), constraintsJson: { grant_ttl_mins: 15, timeout_mins: 1, timeout_action: "approve" } }),
    )
    const result = await resolveApproval(WID, "pa_1", "approve")
    expect(result.ok).toBe(false)
    expect(dbMock.authorizationRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "approved" }) }),
    )
  })
})

describe("resolveApproval — subtree authority (org owner decides down the tree)", () => {
  it("an ancestor owner resolves a descendant pool's approval; the grant is minted on that pool's wallet", async () => {
    const POOL = "pool_9"
    dbMock.pendingApproval.findFirst.mockResolvedValue(pendingApproval({ walletId: POOL }))
    dbMock.pendingApproval.findUnique.mockResolvedValue({ ...pendingApproval({ walletId: POOL }), status: "approved", resolvedAt: new Date(), resolutionNote: "Approved by eric@acme.co" })

    const result = await resolveApproval([WID, POOL], "pa_1", "approve", undefined, "eric@acme.co")
    expect(result.ok).toBe(true)

    // The authority set is the gate — the lookup is scoped to those wallet ids.
    const where = dbMock.pendingApproval.findFirst.mock.calls[0][0].where
    expect(where.walletId).toEqual({ in: [WID, POOL] })
    // The approval resolves against its OWN wallet, not the caller's root: the
    // guarded update and the minted grant both key on the pool, so the grant the
    // agent redeems lives where the escalation was raised.
    expect(dbMock.pendingApproval.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "pa_1", walletId: POOL }) }),
    )
    expect(dbMock.grant.create.mock.calls[0][0].data).toMatchObject({ walletId: POOL, issuedBy: "eric@acme.co" })
  })

  it("refuses an approval outside the authorized set — no lateral reach across the tree", async () => {
    // Not in the caller's subtree → the scoped findFirst misses, and the legacy
    // fallback rejects because the request's wallet isn't authorized either.
    dbMock.pendingApproval.findFirst.mockResolvedValue(null)
    dbMock.authorizationRequest.findUnique.mockResolvedValue({ id: "req_x", status: "escalated", agent: { walletId: "someone_elses_pool", name: "tenet" } })

    const result = await resolveApproval([WID, "pool_9"], "req_x", "approve")
    expect(result).toMatchObject({ ok: false, status: 404 })
    expect(dbMock.grant.create).not.toHaveBeenCalled()
    expect(dbMock.authorizationRequest.updateMany).not.toHaveBeenCalled()
  })
})

describe("resolveApproval — legacy fallback (no PendingApproval row)", () => {
  beforeEach(() => {
    dbMock.pendingApproval.findFirst.mockResolvedValue(null)
  })

  it("404s a request that doesn't exist or belongs to another wallet", async () => {
    dbMock.authorizationRequest.findUnique.mockResolvedValue(null)
    expect(await resolveApproval(WID, "req_x", "approve")).toMatchObject({ ok: false, status: 404 })

    dbMock.authorizationRequest.findUnique.mockResolvedValue({ id: "req_x", status: "escalated", agent: { walletId: "wallet_other", name: "x" } })
    expect(await resolveApproval(WID, "req_x", "approve")).toMatchObject({ ok: false, status: 404 })
  })

  it("409s a request that isn't escalated", async () => {
    dbMock.authorizationRequest.findUnique.mockResolvedValue({ id: "req_x", status: "approved", agent: { walletId: WID, name: "tenet" } })
    expect(await resolveApproval(WID, "req_x", "approve")).toMatchObject({ ok: false, status: 409 })
  })

  it("approves an escalated legacy request directly", async () => {
    dbMock.authorizationRequest.findUnique.mockResolvedValue({ id: "req_x", status: "escalated", agent: { walletId: WID, name: "tenet" }, amountUsd: 60, merchant: "Vendor" })
    const updateMock = vi.fn(async () => ({ id: "req_x", status: "approved", decidedAt: new Date(), decisionNote: "Approved by owner", amountUsd: 60, merchant: "Vendor" }))
    ;(dbMock.authorizationRequest as Record<string, unknown>).update = updateMock
    const result = await resolveApproval(WID, "req_x", "approve")
    expect(result).toMatchObject({ ok: true, status: 200 })
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "approved" }) }))
  })
})

describe("listPendingApprovals — the inbox sweep", () => {
  it("returns pending rows and settles+filters the expired ones", async () => {
    const fresh = pendingApproval({ id: "pa_fresh" })
    const expired = pendingApproval({ id: "pa_old", expiresAt: new Date(Date.now() - 60_000) })
    dbMock.pendingApproval.findMany.mockResolvedValue([fresh, expired])
    const rows = await listPendingApprovals(WID)
    expect(rows.map((r: { id: string }) => r.id)).toEqual(["pa_fresh"])
    // the expired one was settled, not silently dropped
    expect(dbMock.pendingApproval.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "pa_old" }) }),
    )
  })
})
