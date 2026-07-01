import { beforeEach, describe, expect, it, vi } from "vitest"

const { reserveCascadeDailySpendMock } = vi.hoisted(() => ({
  reserveCascadeDailySpendMock: vi.fn(async () => undefined),
}))

vi.mock("../lib/cascadeBudget", () => ({
  reserveCascadeDailySpend: reserveCascadeDailySpendMock,
}))

import { consumeSpendGrant, spendGrantMatches } from "../lib/grants"

const now = new Date("2026-07-01T12:00:00.000Z")
const spendRequest = {
  action: "purchase",
  amountUsd: 40,
  amountCents: 4000,
  merchant: "OpenAI",
  category: "software",
}

function grant(overrides: Record<string, unknown> = {}) {
  return {
    id: "grant_1",
    walletId: "wallet_1",
    agentId: "agent_1",
    actionType: "spend.purchase",
    status: "active",
    resourceJson: {
      kind: "spend",
      action: "purchase",
      amount_usd: 40,
      merchant: "OpenAI",
      category: "software",
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
    amountUsd: 40,
    merchant: "OpenAI",
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

beforeEach(() => {
  vi.clearAllMocks()
})

describe("spend grant consumption", () => {
  it("matches the approved spend resource exactly", () => {
    expect(spendGrantMatches(grant().resourceJson, spendRequest)).toBe(true)
    expect(spendGrantMatches(grant().resourceJson, { ...spendRequest, amountUsd: 41, amountCents: 4100 })).toBe(false)
    expect(spendGrantMatches(grant().resourceJson, { ...spendRequest, merchant: "Anthropic" })).toBe(false)
  })

  it("atomically consumes an active grant and records the source request approval", async () => {
    const tx = client()

    const result = await consumeSpendGrant(tx as never, {
      grantId: "grant_1",
      walletId: "wallet_1",
      agentId: "agent_1",
      request: spendRequest,
      ancestorChain: [],
      execTokenId: null,
      now,
    })

    expect(result).toEqual({
      ok: true,
      request: authRequest(),
      grantId: "grant_1",
      grantExpiresAt: new Date("2026-07-01T12:15:00.000Z"),
      consumedAt: now,
    })
    expect(tx.grant.updateMany).toHaveBeenCalledWith({
      where: { id: "grant_1", status: "active", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      data: { status: "consumed", consumedAt: now },
    })
    expect(reserveCascadeDailySpendMock).toHaveBeenCalledWith(tx, "wallet_1", 4000, now, [])
    expect(tx.authorizationRequest.update).toHaveBeenCalledWith({
      where: { id: "auth_1" },
      data: { status: "approved", decidedAt: now, decisionNote: "Grant consumed" },
    })
    expect(tx.grant.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      reserveCascadeDailySpendMock.mock.invocationCallOrder[0],
    )
  })

  it("rejects a mismatched request without consuming the grant", async () => {
    const tx = client()

    const result = await consumeSpendGrant(tx as never, {
      grantId: "grant_1",
      walletId: "wallet_1",
      agentId: "agent_1",
      request: { ...spendRequest, amountUsd: 41, amountCents: 4100 },
      ancestorChain: [],
      execTokenId: null,
      now,
    })

    expect(result).toEqual({
      ok: false,
      code: "GRANT_MISMATCH",
      status: 403,
      reason: "Grant does not authorize this spend request",
    })
    expect(tx.grant.updateMany).not.toHaveBeenCalled()
    expect(reserveCascadeDailySpendMock).not.toHaveBeenCalled()
  })

  it("rejects an already consumed grant", async () => {
    const tx = client({
      grant: {
        findUnique: vi.fn().mockResolvedValue(grant({ status: "consumed" })),
        updateMany: vi.fn(),
      },
    })

    const result = await consumeSpendGrant(tx as never, {
      grantId: "grant_1",
      walletId: "wallet_1",
      agentId: "agent_1",
      request: spendRequest,
      ancestorChain: [],
      execTokenId: null,
      now,
    })

    expect(result).toEqual({ ok: false, code: "GRANT_ALREADY_USED", status: 409, reason: "Grant already consumed" })
    expect(tx.grant.updateMany).not.toHaveBeenCalled()
    expect(reserveCascadeDailySpendMock).not.toHaveBeenCalled()
  })

  it("honors execution-token budget before consuming the grant", async () => {
    const tx = client()
    tx.executionToken.findUnique.mockResolvedValue({
      id: "exec_1",
      status: "active",
      expiresAt: new Date("2026-07-01T12:05:00.000Z"),
      spentUsd: 20,
      budgetUsd: 50,
    })

    const result = await consumeSpendGrant(tx as never, {
      grantId: "grant_1",
      walletId: "wallet_1",
      agentId: "agent_1",
      request: spendRequest,
      ancestorChain: [],
      execTokenId: "exec_1",
      now,
    })

    expect(result).toEqual({
      ok: false,
      code: "EXEC_BUDGET_EXCEEDED",
      status: 403,
      reason: "Execution budget exceeded",
    })
    expect(tx.grant.updateMany).not.toHaveBeenCalled()
    expect(reserveCascadeDailySpendMock).not.toHaveBeenCalled()
  })
})
