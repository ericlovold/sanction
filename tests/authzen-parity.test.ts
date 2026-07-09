import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest"
import { NextRequest } from "next/server"
import { hashApiKey } from "../lib/apiKey"

// Cross-surface parity: the AuthZEN PDP must answer the SAME as /authorize for
// the same request + policy + state (determinism principle). These prove the
// two capabilities that had drifted onto the native surface only:
//   - KILL-1 wallet freeze denies on the PDP too (fresh eval AND grant redeem)
//   - CPO-1 cost-per-outcome ceiling escalates on the PDP too, even sub-floor
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    agent: { findUnique: vi.fn(), update: vi.fn() },
    authorizationRequest: { aggregate: vi.fn(), create: vi.fn() },
  },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("@/lib/cascadeBudget", async (orig) => {
  const mod = await orig<typeof import("@/lib/cascadeBudget")>()
  return { ...mod, walletAncestorChain: vi.fn(async () => []), cascadeDailyWouldExceed: vi.fn(async () => false) }
})
// Stub the CPO context read; the pure rule is proven in the ladder tests.
vi.mock("@/lib/outcomes", () => ({ cpoContext: vi.fn(async () => undefined) }))

import { POST as evaluation } from "../app/api/access/v1/evaluation/route"
import { walletAncestorChain } from "../lib/cascadeBudget"
import { cpoContext } from "../lib/outcomes"

const KEY = "pxy_testagentkey"
const WID = "wallet_1"
const AID = "agent_1"

const POLICY = {
  id: "pol_1",
  walletId: WID,
  dailyTokenBudgetUsd: 1000,
  dailySpendBudgetUsd: 1_000_000,
  monthlySpendBudgetUsd: null,
  subtreeDailyCapUsd: null,
  perTransactionMaxUsd: 10_000,
  autoApproveUnderUsd: 1_000, // $10 auto-approve floor — a $5 spend is sub-floor
  escalateOverUsd: 5_000,
  allowedCategories: [],
  blockedCategories: [],
  allowedTools: [],
  blockedTools: [],
  escalateTools: [],
  allowedResources: [],
  blockedResources: [],
  escalateResources: [],
  escalationTimeoutMins: 0,
  escalationTimeoutAction: "deny",
  outcomeKind: null,
  costPerOutcomeCeilingUsd: null,
  costPerOutcomeWindowDays: 30,
  costPerOutcomeMinOutcomes: 5,
}

const AGENT = {
  id: AID,
  walletId: WID,
  name: "tenet",
  isActive: true,
  lastUsedAt: new Date(),
  dailyTokenBudgetUsd: null,
  dailySpendBudgetUsd: null,
  perTransactionMaxUsd: null,
  escalateOverUsd: null,
  apiKeyHash: hashApiKey(KEY),
  wallet: { id: WID, ownerEmail: "owner@example.com", policy: POLICY },
}

const subject = { type: "agent", id: AID }
const spend = (amountUsd: number) => ({
  subject,
  action: { name: "purchase", properties: { amount_usd: amountUsd } },
  resource: { type: "spend", id: "github" },
})
function req(body: unknown) {
  return new NextRequest("https://test.local/api/access/v1/evaluation", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": KEY },
    body: JSON.stringify(body),
  })
}
const frozenChain = [{ id: WID, parentId: null, frozenAt: new Date(), frozenReason: "runaway", policy: { perTransactionMaxUsd: 10_000, subtreeDailyCapUsd: null } }]

beforeAll(() => {
  process.env.SANCTION_SIGNING_SECRET ??= "test-signing-secret-material"
})
beforeEach(() => {
  vi.clearAllMocks()
  dbMock.agent.findUnique.mockResolvedValue(AGENT)
  dbMock.agent.update.mockResolvedValue({})
  dbMock.authorizationRequest.aggregate.mockResolvedValue({ _sum: { amountUsd: 0 } })
  vi.mocked(walletAncestorChain).mockResolvedValue([])
  vi.mocked(cpoContext).mockResolvedValue(undefined)
})

describe("KILL-1 freeze parity on the AuthZEN PDP", () => {
  it("denies a fresh spend evaluation with WALLET_FROZEN when the wallet is frozen", async () => {
    vi.mocked(walletAncestorChain).mockResolvedValue(frozenChain as never)
    const res = await evaluation(req(spend(5)))
    const body = await res.json()
    expect(res.status).toBe(200) // AuthZEN: a deny is a successful evaluation
    expect(body.decision).toBe(false)
    expect(body.context.code).toBe("WALLET_FROZEN")
  })

  it("denies WALLET_FROZEN before redeeming a grant (no write on a frozen wallet)", async () => {
    vi.mocked(walletAncestorChain).mockResolvedValue(frozenChain as never)
    const body = {
      subject,
      action: { name: "purchase", properties: { amount_usd: 5 } },
      resource: { type: "spend", id: "github" },
      context: { approval: { id: "grant_1" } },
    }
    const res = await evaluation(req(body))
    const out = await res.json()
    expect(out.decision).toBe(false)
    expect(out.context.code).toBe("WALLET_FROZEN")
    // The redeem path never ran — no authorizationRequest write.
    expect(dbMock.authorizationRequest.create).not.toHaveBeenCalled()
  })

  it("allows a normal sub-floor spend when NOT frozen (control)", async () => {
    const res = await evaluation(req(spend(5)))
    const body = await res.json()
    expect(body.decision).toBe(true)
  })
})

describe("CPO-1 ceiling parity on the AuthZEN PDP", () => {
  it("escalates a sub-floor spend when the cost-per-outcome ceiling is breached", async () => {
    // $50 ceiling, 10 outcomes ⇒ $500 allowance; $1000 already spent ⇒ over.
    vi.mocked(cpoContext).mockResolvedValue({ ceilingCents: 5_000, windowSpendUsd: 1_000, windowOutcomes: 10, minOutcomes: 5 })
    const res = await evaluation(req(spend(5))) // sub-floor: ladder alone would auto-approve
    const body = await res.json()
    expect(body.decision).toBe(false)
    expect(body.context.code).toBe("COST_PER_OUTCOME_CEILING")
  })

  it("does not govern before the minimum-outcomes sample (cold start)", async () => {
    vi.mocked(cpoContext).mockResolvedValue({ ceilingCents: 5_000, windowSpendUsd: 1_000, windowOutcomes: 2, minOutcomes: 5 })
    const res = await evaluation(req(spend(5)))
    const body = await res.json()
    expect(body.decision).toBe(true)
  })
})
