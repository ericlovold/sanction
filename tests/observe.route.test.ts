import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest"
import { NextRequest } from "next/server"
import { hashApiKey } from "../lib/apiKey"

// OBS-1: observe mode — the engine runs identically and persists the truthful
// would-be decision (marked observed in detailsJson), but nothing is blocked,
// no approvals page anyone, and no enforcement state is written. These tests
// pin the contract on both wedge routes (/authorize, /authorize/tool); the
// enforce-mode control cases prove the flag off means byte-identical behavior
// (the full existing suites are the broader proof — their policies default to
// enforce).
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    agent: { findUnique: vi.fn(), update: vi.fn() },
    authorizationRequest: { findUnique: vi.fn(), create: vi.fn(), aggregate: vi.fn() },
    executionToken: { findUnique: vi.fn(), update: vi.fn() },
    pendingApproval: { findFirst: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("next/server", async (orig) => {
  const mod = await orig<typeof import("next/server")>()
  return { ...mod, after: (fn: () => unknown) => void fn() }
})
vi.mock("@/lib/webhooks", () => ({ deliverEvent: vi.fn(async () => {}), APPROVE_URL: "https://test.local/approve", approveUrlFor: (id?: string) => `https://test.local/approve${id ? `?review=${id}` : ""}` }))
vi.mock("@/lib/email", () => ({ sendEscalationEmail: vi.fn(async () => {}) }))
vi.mock("@/lib/thresholds", () => ({
  notifySpendBudgetThreshold: vi.fn(async () => {}),
  notifyPoolCapThresholds: vi.fn(async () => {}),
}))
vi.mock("@/lib/approvals", async (orig) => {
  const mod = await orig<typeof import("@/lib/approvals")>()
  return {
    ...mod,
    createSpendPendingApproval: vi.fn(async () => ({ id: "pa_1" })),
    createToolPendingApproval: vi.fn(async () => ({ id: "pa_2" })),
  }
})
vi.mock("@/lib/cascadeBudget", async (orig) => {
  const mod = await orig<typeof import("@/lib/cascadeBudget")>()
  return {
    ...mod,
    walletAncestorChain: vi.fn(async () => []),
    reserveCascadeDailySpend: vi.fn(async () => []),
    cascadeDailyWouldExceed: vi.fn(async () => false),
  }
})
vi.mock("@/lib/freeze", async (orig) => {
  const mod = await orig<typeof import("@/lib/freeze")>()
  return { ...mod, walletFreezeState: vi.fn(async () => ({ frozen: false })) }
})

import { POST as authorize } from "../app/api/v1/authorize/route"
import { POST as authorizeTool } from "../app/api/v1/authorize/tool/route"
import { createSpendPendingApproval, createToolPendingApproval } from "../lib/approvals"
import { cascadeDailyWouldExceed, reserveCascadeDailySpend } from "../lib/cascadeBudget"
import { deliverEvent } from "../lib/webhooks"

const KEY = "pxy_observetestkey"
const WID = "wallet_obs"
const AID = "agent_obs"

// Bands (cents): auto < $10, escalate > $50, hard cap $100.
const OBSERVE_POLICY = {
  id: "pol_obs",
  walletId: WID,
  currentRevision: 1,
  dailyTokenBudgetUsd: 1000,
  dailySpendBudgetUsd: 1_000_000,
  monthlySpendBudgetUsd: null,
  subtreeDailyCapUsd: null,
  perTransactionMaxUsd: 10_000,
  autoApproveUnderUsd: 1_000,
  escalateOverUsd: 5_000,
  allowedCategories: [],
  blockedCategories: ["gambling"],
  allowedTools: [],
  blockedTools: ["shell.exec"],
  escalateTools: ["email.send"],
  allowedResources: [],
  blockedResources: [],
  escalateResources: [],
  escalationTimeoutMins: 0,
  escalationTimeoutAction: "deny",
  enforcementMode: "observe",
}

const AGENT = {
  id: AID,
  walletId: WID,
  name: "watcher",
  isActive: true,
  lastUsedAt: new Date(),
  dailyTokenBudgetUsd: null,
  dailySpendBudgetUsd: null,
  perTransactionMaxUsd: null,
  escalateOverUsd: null,
  apiKeyHash: hashApiKey(KEY),
  wallet: { id: WID, ownerEmail: "owner@example.com", policy: OBSERVE_POLICY },
}

function req(path: string, body: unknown, idempotencyKey?: string) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-api-key": KEY }
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey
  return new NextRequest(`https://test.local/api/v1${path}`, { method: "POST", headers, body: JSON.stringify(body) })
}

const SPEND = { action: "purchase", amount_usd: 5, merchant: "Anthropic", category: "software" }

beforeAll(() => {
  process.env.SANCTION_SIGNING_SECRET ??= "test-signing-secret-material"
})

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.agent.findUnique.mockResolvedValue(AGENT)
  dbMock.agent.update.mockResolvedValue({})
  dbMock.authorizationRequest.findUnique.mockResolvedValue(null)
  dbMock.authorizationRequest.aggregate.mockResolvedValue({ _sum: { amountUsd: 0 } })
  dbMock.authorizationRequest.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "req_obs",
    createdAt: new Date(),
    decidedAt: null,
    decisionNote: null,
    ...data,
  }))
  dbMock.pendingApproval.findFirst.mockResolvedValue(null)
  dbMock.$transaction.mockImplementation(async (fn: (tx: typeof dbMock) => unknown) => fn(dbMock))
  dbMock.$executeRaw.mockResolvedValue(undefined)
  vi.mocked(cascadeDailyWouldExceed).mockResolvedValue(false)
})

describe("observe mode — spend route", () => {
  it("a would-be denial returns authorized 200 with the truthful would_be, persists denied + observed", async () => {
    const res = await authorize(req("/authorize", { ...SPEND, category: "gambling" }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ authorized: true, status: "approved", mode: "observe" })
    expect(body.would_be.status).toBe("denied")
    expect(body.would_be.code).toBeTruthy()
    expect(dbMock.authorizationRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "denied", detailsJson: expect.objectContaining({ observed: true }) }),
      }),
    )
  })

  it("a would-be hard-cap denial (stateless gate) also observes through", async () => {
    const res = await authorize(req("/authorize", { ...SPEND, amount_usd: 200 }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.authorized).toBe(true)
    expect(body.would_be).toMatchObject({ status: "denied", code: "PER_TXN_LIMIT" })
  })

  it("a would-be escalation logs but pages no one — no PendingApproval, no webhook, no email", async () => {
    const res = await authorize(req("/authorize", { ...SPEND, amount_usd: 60 }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ authorized: true, mode: "observe" })
    expect(body.would_be.status).toBe("escalated")
    expect(createSpendPendingApproval).not.toHaveBeenCalled()
    expect(deliverEvent).not.toHaveBeenCalled()
  })

  it("the would_be stays truthful for subtree caps — read-only check, no counter writes", async () => {
    // The subtree cap lives outside the ladder; observe must still report it.
    vi.mocked(cascadeDailyWouldExceed).mockResolvedValue(true)
    const res = await authorize(req("/authorize", SPEND))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ authorized: true, mode: "observe" })
    expect(body.would_be).toMatchObject({ status: "denied", code: "SUBTREE_CAP_EXCEEDED" })
    expect(reserveCascadeDailySpend).not.toHaveBeenCalled()
  })

  it("a would-be approval writes no enforcement state — no cascade reserve", async () => {
    const res = await authorize(req("/authorize", SPEND))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.would_be.status).toBe("approved")
    expect(reserveCascadeDailySpend).not.toHaveBeenCalled()
    expect(dbMock.executionToken.update).not.toHaveBeenCalled()
  })

  it("an idempotent replay of an observed row keeps the observed envelope", async () => {
    dbMock.authorizationRequest.findUnique.mockResolvedValue({
      id: "req_prev",
      status: "denied",
      decisionNote: "Category 'gambling' is blocked",
      amountUsd: 5,
      merchant: "Anthropic",
      detailsJson: { observed: true },
    })
    const res = await authorize(req("/authorize", { ...SPEND, category: "gambling" }, "idem-1"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ authorized: true, mode: "observe" })
    expect(body.would_be.status).toBe("denied")
  })

  it("enforce mode is untouched — the identical request denies 403", async () => {
    dbMock.agent.findUnique.mockResolvedValue({
      ...AGENT,
      wallet: { ...AGENT.wallet, policy: { ...OBSERVE_POLICY, enforcementMode: "enforce" } },
    })
    const res = await authorize(req("/authorize", { ...SPEND, category: "gambling" }))
    expect(res.status).toBe(403)
    expect((await res.json()).authorized).toBe(false)
  })
})

describe("observe mode — tool route", () => {
  it("a would-be blocked tool returns allowed with would_be denied, persists observed", async () => {
    const res = await authorizeTool(req("/authorize/tool", { tool: "shell.exec" }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ authorized: true, status: "allowed", mode: "observe" })
    expect(body.would_be.status).toBe("denied")
    expect(dbMock.authorizationRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "denied", detailsJson: expect.objectContaining({ observed: true }) }),
      }),
    )
  })

  it("a would-be tool escalation logs but pages no one", async () => {
    const res = await authorizeTool(req("/authorize/tool", { tool: "email.send" }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ authorized: true, status: "allowed", mode: "observe" })
    expect(body.would_be.status).toBe("escalated")
    expect(createToolPendingApproval).not.toHaveBeenCalled()
    expect(deliverEvent).not.toHaveBeenCalled()
  })

  it("an allowed tool stays a plain allow — no observe envelope needed", async () => {
    const res = await authorizeTool(req("/authorize/tool", { tool: "kb.search" }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ authorized: true, status: "allowed" })
    expect(body.mode).toBeUndefined()
  })

  it("enforce mode is untouched — the identical blocked tool denies 403", async () => {
    dbMock.agent.findUnique.mockResolvedValue({
      ...AGENT,
      wallet: { ...AGENT.wallet, policy: { ...OBSERVE_POLICY, enforcementMode: "enforce" } },
    })
    const res = await authorizeTool(req("/authorize/tool", { tool: "shell.exec" }))
    expect(res.status).toBe(403)
    expect((await res.json()).authorized).toBe(false)
  })
})
