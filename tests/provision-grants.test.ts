import { beforeEach, describe, expect, it, vi } from "vitest"

const { reserveCascadeDailySpendMock } = vi.hoisted(() => ({
  reserveCascadeDailySpendMock: vi.fn(async () => undefined),
}))

vi.mock("../lib/cascadeBudget", () => ({
  reserveCascadeDailySpend: reserveCascadeDailySpendMock,
}))

import { consumeProvisionGrant, provisionGrantMatches } from "../lib/grants"

const now = new Date("2026-07-01T12:00:00.000Z")
const provisionRequest = {
  resource: "azure.seat",
  lineItem: "Microsoft 365 E3",
  quantity: 5,
  amountUsd: 62.5,
  amountCents: 6250,
  category: "licenses",
}

function grant(overrides: Record<string, unknown> = {}) {
  return {
    id: "grant_1",
    walletId: "wallet_1",
    agentId: "agent_1",
    actionType: "provision.allocate",
    status: "active",
    resourceJson: {
      kind: "provision",
      resource: "azure.seat",
      line_item: "Microsoft 365 E3",
      quantity: 5,
      unit_price_usd: 12.5,
      amount_usd: 62.5,
      category: "licenses",
    },
    sourceType: "authorization_request",
    sourceId: "auth_1",
    expiresAt: new Date("2026-07-01T12:15:00.000Z"),
    ...overrides,
  }
}

function authRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: "auth_1",
    status: "approved",
    decisionNote: "Grant consumed",
    amountUsd: 62.5,
    merchant: "azure.seat",
    decidedAt: now,
    ...overrides,
  }
}

function client(overrides: Record<string, unknown> = {}) {
  return {
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    wallet: { findUnique: vi.fn() },
    authorizationRequest: { update: vi.fn().mockResolvedValue(authRequest()) },
    executionToken: { findUnique: vi.fn(), update: vi.fn() },
    grant: {
      findUnique: vi.fn().mockResolvedValue(grant()),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    ...overrides,
  }
}

function consumeInput(overrides: Record<string, unknown> = {}) {
  return {
    grantId: "grant_1",
    walletId: "wallet_1",
    agentId: "agent_1",
    request: provisionRequest,
    ancestorChain: [],
    execTokenId: null,
    now,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("provision grant matching", () => {
  it("matches the approved provision exactly", () => {
    expect(provisionGrantMatches(grant().resourceJson, provisionRequest)).toBe(true)
  })

  it("rejects any drifted field — resource, line item, quantity, amount, category", () => {
    const r = grant().resourceJson
    expect(provisionGrantMatches(r, { ...provisionRequest, resource: "aws.seat" })).toBe(false)
    expect(provisionGrantMatches(r, { ...provisionRequest, lineItem: "Microsoft 365 E5" })).toBe(false)
    expect(provisionGrantMatches(r, { ...provisionRequest, quantity: 6 })).toBe(false)
    expect(provisionGrantMatches(r, { ...provisionRequest, amountUsd: 75, amountCents: 7500 })).toBe(false)
    expect(provisionGrantMatches(r, { ...provisionRequest, category: "software" })).toBe(false)
  })

  it("rejects a spend-kind grant resource", () => {
    expect(
      provisionGrantMatches({ kind: "spend", action: "purchase", amount_usd: 62.5, merchant: "azure.seat", category: "licenses" }, provisionRequest),
    ).toBe(false)
  })
})

describe("provision grant consumption", () => {
  it("consumes an active matching grant and settles the source request", async () => {
    const c = client()
    const result = await consumeProvisionGrant(c as never, consumeInput() as never)
    expect(result.ok).toBe(true)
    expect(c.grant.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "consumed", consumedAt: now } }),
    )
    expect(c.authorizationRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "auth_1" }, data: expect.objectContaining({ status: "approved" }) }),
    )
    expect(reserveCascadeDailySpendMock).toHaveBeenCalledWith(expect.anything(), "wallet_1", 6250, now, [])
  })

  it("rejects a grant of a different action type as unsupported", async () => {
    const c = client({ grant: { findUnique: vi.fn().mockResolvedValue(grant({ actionType: "spend.purchase" })), updateMany: vi.fn() } })
    const result = await consumeProvisionGrant(c as never, consumeInput() as never)
    expect(result).toMatchObject({ ok: false, code: "GRANT_UNSUPPORTED", status: 403 })
  })

  it("rejects a mismatched provision without consuming", async () => {
    const c = client()
    const result = await consumeProvisionGrant(
      c as never,
      consumeInput({ request: { ...provisionRequest, quantity: 6 } }) as never,
    )
    expect(result).toMatchObject({ ok: false, code: "GRANT_MISMATCH", status: 403 })
    expect(c.grant.updateMany).not.toHaveBeenCalled()
  })

  it("expires a stale grant instead of consuming it", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    const c = client({
      grant: { findUnique: vi.fn().mockResolvedValue(grant({ expiresAt: new Date("2026-07-01T11:00:00.000Z") })), updateMany },
    })
    const result = await consumeProvisionGrant(c as never, consumeInput() as never)
    expect(result).toMatchObject({ ok: false, code: "GRANT_EXPIRED", status: 403 })
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "expired" } }),
    )
  })

  it("reports an already-consumed grant", async () => {
    const c = client({ grant: { findUnique: vi.fn().mockResolvedValue(grant({ status: "consumed" })), updateMany: vi.fn() } })
    const result = await consumeProvisionGrant(c as never, consumeInput() as never)
    expect(result).toMatchObject({ ok: false, code: "GRANT_ALREADY_USED", status: 409 })
  })

  it("loses the concurrent-consume race safely (guarded updateMany count 0)", async () => {
    const c = client({
      grant: { findUnique: vi.fn().mockResolvedValue(grant()), updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    })
    const result = await consumeProvisionGrant(c as never, consumeInput() as never)
    expect(result).toMatchObject({ ok: false, code: "GRANT_ALREADY_USED", status: 409 })
  })

  it("enforces the execution-token budget", async () => {
    const c = client({
      executionToken: {
        findUnique: vi.fn().mockResolvedValue({ status: "active", expiresAt: new Date("2026-07-01T13:00:00.000Z"), spentUsd: 950, budgetUsd: 1000 }),
        update: vi.fn(),
      },
    })
    const result = await consumeProvisionGrant(c as never, consumeInput({ execTokenId: "exec_1" }) as never)
    expect(result).toMatchObject({ ok: false, code: "EXEC_BUDGET_EXCEEDED", status: 403 })
  })
})
