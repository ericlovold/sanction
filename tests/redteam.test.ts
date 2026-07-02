import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest"
import { NextRequest } from "next/server"
import { hashApiKey } from "../lib/apiKey"

// Red-team guardrail suite — the Eve `redteam` persona, as a CI gate.
//
// examples/eve-testers/agent/subagents/redteam runs five adversarial probes
// against a *live* Sanction and reports "N/5 guardrails held". That's a great
// demo but it needs the eve runtime, a provisioned wallet, and a network round
// trip — so it never runs in CI. This file ports the same five probes to the
// real route handlers in-process (no eve, no secrets, no DB): each probe drives
// the actual POST handler and asserts the action was BLOCKED. The suite passing
// IS the 5/5 scorecard. A guardrail regression turns this red before merge.
//
// A denial is a PASS. The only failure is an action that SHOULD have been blocked
// getting through. Each probe deliberately targets a different enforcement layer:
//   1. over-limit spend      → policy engine        (POST /authorize)
//   2. blocked category      → policy engine        (POST /authorize)
//   3. over-clearance cred   → issuance gate        (POST /exec)
//   4. out-of-scope inject   → token scope boundary (POST /credentials/inject)
//   5. exec-budget breach    → execution-budget gate(POST /authorize + exec JWT)
//
// Per-layer behaviors are also covered in authorize.route/exec.route/
// credential-inject.route tests; this file is the consolidated adversarial
// contract, named 1:1 to the redteam persona so the guarantee is legible.
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    agent: { findUnique: vi.fn(), update: vi.fn() },
    agentClearance: { findUnique: vi.fn() },
    authorizationRequest: { findUnique: vi.fn(), create: vi.fn(), aggregate: vi.fn() },
    executionToken: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    credentialVault: { findMany: vi.fn(), findFirst: vi.fn() },
    credentialInjection: { create: vi.fn() },
    pendingApproval: { findFirst: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
// RLS isolation is proven in rls.db.test.ts; here withTenant hands back the mock.
vi.mock("@/lib/rls", () => ({ withTenant: (_w: unknown, fn: (tx: unknown) => unknown) => fn(dbMock) }))
vi.mock("next/server", async (orig) => {
  const mod = await orig<typeof import("next/server")>()
  return { ...mod, after: () => {} }
})
// Authorize's post-decision side effects — irrelevant to a denial, stubbed out.
vi.mock("@/lib/webhooks", () => ({ deliverEvent: vi.fn(async () => {}), APPROVE_URL: "https://test.local/approve" }))
vi.mock("@/lib/email", () => ({ sendEscalationEmail: vi.fn(async () => {}) }))
vi.mock("@/lib/thresholds", () => ({
  notifySpendBudgetThreshold: vi.fn(async () => {}),
  notifyPoolCapThresholds: vi.fn(async () => {}),
}))
vi.mock("@/lib/approvals", async (orig) => {
  const mod = await orig<typeof import("@/lib/approvals")>()
  return { ...mod, createSpendPendingApproval: vi.fn(async () => ({ id: "pa_1" })) }
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
vi.mock("@/lib/grants", async (orig) => {
  const mod = await orig<typeof import("@/lib/grants")>()
  return { ...mod, consumeSpendGrant: vi.fn() }
})
// NB: @/lib/jwt is intentionally NOT mocked — probes 4 and 5 issue and verify
// real execution JWTs so the token boundary is exercised for real.

import { POST as authorize } from "../app/api/v1/authorize/route"
import { POST as issueExec } from "../app/api/v1/exec/route"
import { POST as inject } from "../app/api/v1/credentials/inject/route"
import { issueExecutionJWT } from "../lib/jwt"

const KEY = "pxy_redteamagentkey"
const WID = "wallet_rt"
const AID = "agent_rt"

// Bands (cents): auto-approve < $10, escalate > $50, hard cap $100. crypto blocked.
const POLICY = {
  id: "pol_rt",
  walletId: WID,
  dailyTokenBudgetUsd: 1000,
  dailySpendBudgetUsd: 1_000_000,
  subtreeDailyCapUsd: null,
  perTransactionMaxUsd: 10_000,
  autoApproveUnderUsd: 1_000,
  escalateOverUsd: 5_000,
  allowedCategories: [],
  blockedCategories: ["gambling", "adult", "crypto"],
  allowedTools: [],
  blockedTools: [],
  escalateTools: [],
  allowedResources: [],
  blockedResources: [],
  escalateResources: [],
  escalationTimeoutMins: 0,
  escalationTimeoutAction: "deny",
}

const AGENT = {
  id: AID,
  walletId: WID,
  name: "adversary",
  isActive: true,
  lastUsedAt: new Date(),
  dailyTokenBudgetUsd: null,
  dailySpendBudgetUsd: null,
  perTransactionMaxUsd: null,
  escalateOverUsd: null,
  apiKeyHash: hashApiKey(KEY),
  wallet: { id: WID, ownerEmail: "owner@example.com", policy: POLICY },
}

function authReq(body: unknown, opts: { bearer?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-api-key": KEY }
  if (opts.bearer) headers["authorization"] = `Bearer ${opts.bearer}`
  return new NextRequest("https://test.local/api/v1/authorize", { method: "POST", headers, body: JSON.stringify(body) })
}
function execReq(body: unknown) {
  return new NextRequest("https://test.local/api/v1/exec", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": KEY },
    body: JSON.stringify(body),
  })
}
function injectReq(body: unknown, token: string) {
  return new NextRequest("https://test.local/api/v1/credentials/inject", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
}

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
    id: "req_rt",
    createdAt: new Date(),
    decidedAt: null,
    decisionNote: null,
    ...data,
  }))
  dbMock.pendingApproval.findFirst.mockResolvedValue({ id: "pa_1", actionType: "spend.purchase", resourceJson: {}, reason: "r" })
  dbMock.$transaction.mockImplementation(async (fn: (tx: typeof dbMock) => unknown) => fn(dbMock))
  dbMock.$executeRaw.mockResolvedValue(undefined)
})

describe("Red-team guardrail probes — the Eve redteam persona as a CI gate", () => {
  // Probe 1 — over-limit spend. $500 ≫ $100 hard cap → hard deny.
  it("1. blocks an over-limit spend ($500 over a $100 cap)", async () => {
    const res = await authorize(authReq({ action: "purchase", amount_usd: 500, merchant: "MegaCorp", category: "software" }))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe("PER_TXN_LIMIT")
  })

  // Probe 2 — blocked category. A crypto purchase is denied regardless of amount.
  it("2. blocks a purchase in a blocked category (crypto)", async () => {
    const res = await authorize(authReq({ action: "purchase", amount_usd: 5, merchant: "Coinbase", category: "crypto" }))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe("CATEGORY_BLOCKED")
  })

  // Probe 3 — over-clearance credential. Agent holds clearance 1; ROOT_DB_URL
  // requires 5. The execution token must not issue.
  it("3. blocks issuing an execution token for an over-clearance credential", async () => {
    dbMock.agentClearance.findUnique.mockResolvedValue({ level: 1 })
    dbMock.credentialVault.findMany.mockResolvedValue([{ label: "ROOT_DB_URL", allowedAgentIds: [], minClearance: 5 }])
    const res = await issueExec(execReq({ scope: ["ROOT_DB_URL"], budget_usd: 5, ttl_seconds: 300 }))
    expect(res.status).toBe(403)
    expect(dbMock.executionToken.create).not.toHaveBeenCalled()
  })

  // Probe 4 — out-of-scope injection. A real JWT scoped to STRIPE_KEY cannot be
  // used to pull ROOT_DB_URL. The scope guard rejects before any DB/decrypt call.
  it("4. blocks injecting a credential outside the JWT's scope", async () => {
    const { jwt } = await issueExecutionJWT({ agent: AID, wallet: WID, scope: ["STRIPE_KEY"], budget_usd: 10, clearance: 3 })
    const res = await inject(injectReq({ credential_label: "ROOT_DB_URL" }, jwt))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe("'ROOT_DB_URL' not in JWT scope")
    // The boundary held before the engine — no lookup, no decryption.
    expect(dbMock.credentialVault.findFirst).not.toHaveBeenCalled()
    expect(dbMock.credentialInjection.create).not.toHaveBeenCalled()
  })

  // Probe 5 — exec-budget breach. A spend that pushes the execution token past
  // its own hard cap must not auto-approve, even though $5 is under the wallet
  // auto-approve floor. The per-execution ceiling is independent of wallet policy.
  it("5. blocks a spend that breaches the execution token's budget cap", async () => {
    const { jwt, jti } = await issueExecutionJWT({ agent: AID, wallet: WID, scope: [], budget_usd: 10, clearance: 1 })
    dbMock.executionToken.findUnique.mockResolvedValue({
      id: jti, status: "active", expiresAt: new Date(Date.now() + 60_000), spentUsd: 9, budgetUsd: 10,
    })
    const res = await authorize(authReq({ action: "purchase", amount_usd: 5, merchant: "Anthropic", category: "software" }, { bearer: jwt }))
    const body = await res.json()
    expect(body.authorized).toBe(false) // $9 spent + $5 > $10 exec cap
  })
})
