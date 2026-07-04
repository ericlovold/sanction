import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { hashApiKey } from "../lib/apiKey"

// EVID-1: decisions you can replay. Unit-proves the evidence module's
// determinism contract and the evidence endpoint's wire: the policy revision
// in force, the stored engine context, and a live replay whose `matches`
// flag only holds when the record still reproduces the decision.
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    agent: { findUnique: vi.fn(), update: vi.fn() },
    authorizationRequest: { findUnique: vi.fn() },
    policyRevision: { findFirst: vi.fn() },
  },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("@/lib/ownerAuth", () => ({ authenticateOwner: vi.fn(async () => ({ wallet: null })) }))

import { authenticateOwner } from "../lib/ownerAuth"
import { decisionEvidence, replayEvidence, type DecisionEvidence } from "../lib/evidence"
import { GET as evidenceRoute } from "../app/api/v1/authorize/[id]/evidence/route"

const KEY = "pxy_testagentkey"
const WID = "wallet_1"

const AGENT = {
  id: "agent_1",
  walletId: WID,
  name: "tenet",
  isActive: true,
  lastUsedAt: new Date(),
  apiKeyHash: hashApiKey(KEY),
  wallet: { id: WID, ownerEmail: "o@example.com", policy: null },
}

// A denied spend: $150 against a $100 per-transaction cap.
const SPEND_CTX = {
  amountUsd: 150,
  amountCents: 15_000,
  category: "software",
  blockedCategories: [],
  allowedCategories: [],
  perTxnMaxCents: 10_000,
  dailySpentUsd: 0,
  dailyBudgetCents: 1_000_000,
  monthlySpentUsd: 0,
  monthlyBudgetCents: null,
  autoApproveUnderCents: 1_000,
  escalateOverCents: 5_000,
}

function getReq(key: string | null = KEY) {
  const headers: Record<string, string> = {}
  if (key) headers["x-api-key"] = key
  return new NextRequest("https://test.local/api/v1/authorize/req_1/evidence", { method: "GET", headers })
}

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.agent.findUnique.mockResolvedValue(AGENT)
  dbMock.agent.update.mockResolvedValue({})
  dbMock.policyRevision.findFirst.mockResolvedValue(null)
})

describe("lib/evidence — determinism", () => {
  it("write-time evidence equals its own replay, by construction", () => {
    const e = decisionEvidence("spend", SPEND_CTX)
    expect(e.effect).toBe("deny")
    expect(e.code).toBe("PER_TXN_LIMIT")
    expect(e.rule_id).toBe("per_transaction")
    const replay = replayEvidence(e)
    expect(replay?.matches).toBe(true)
  })

  it("replay is stable across repeated runs (pure rules)", () => {
    const e = decisionEvidence("tool", { tool: "github.merge_pr", blockedTools: [], allowedTools: [], escalateTools: ["github.merge_pr"] })
    expect(replayEvidence(e)?.effect).toBe("escalate")
    expect(replayEvidence(e)?.matches).toBe(true)
  })

  it("a tampered record fails the replay", () => {
    const e = decisionEvidence("spend", SPEND_CTX)
    const tampered: DecisionEvidence = { ...e, effect: "allow", code: undefined }
    const replay = replayEvidence(tampered)
    expect(replay?.effect).toBe("deny")
    expect(replay?.matches).toBe(false)
  })

  it("returns null for unknown ladders or missing context", () => {
    expect(replayEvidence({ ladder: "nope", effect: "deny", rule_id: "x", ctx: {} } as never)).toBeNull()
  })
})

describe("GET /v1/authorize/{id}/evidence", () => {
  const row = (overrides: Record<string, unknown> = {}) => ({
    id: "req_1",
    kind: "spend",
    status: "denied",
    decidedAt: new Date(),
    decisionNote: "Exceeds per-transaction limit of $100",
    policyRevision: 3,
    decisionContextJson: decisionEvidence("spend", SPEND_CTX),
    agent: { name: "tenet", walletId: WID },
    ...overrides,
  })

  it("404s for an unknown request", async () => {
    dbMock.authorizationRequest.findUnique.mockResolvedValue(null)
    const res = await evidenceRoute(getReq(), { params: Promise.resolve({ id: "req_1" }) })
    expect(res.status).toBe(404)
  })

  it("401s a foreign wallet's agent key", async () => {
    dbMock.authorizationRequest.findUnique.mockResolvedValue(row({ agent: { name: "x", walletId: "wallet_other" } }))
    const res = await evidenceRoute(getReq(), { params: Promise.resolve({ id: "req_1" }) })
    expect(res.status).toBe(401)
  })

  it("returns revision, decision, context, and a matching replay", async () => {
    dbMock.authorizationRequest.findUnique.mockResolvedValue(row())
    dbMock.policyRevision.findFirst.mockResolvedValue({
      revision: 3,
      createdAt: new Date(),
      snapshotJson: { perTransactionMaxUsd: 10_000 },
    })
    const res = await evidenceRoute(getReq(), { params: Promise.resolve({ id: "req_1" }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.code).toBe("PER_TXN_LIMIT")
    expect(body.policy_revision.revision).toBe(3)
    expect(body.policy_revision.policy.perTransactionMaxUsd).toBe(10_000)
    expect(body.decision.rule_id).toBe("per_transaction")
    expect(body.context.amountCents).toBe(15_000)
    expect(body.replay.matches).toBe(true)
  })

  it("grants the owner's management key access without an agent key", async () => {
    dbMock.agent.findUnique.mockResolvedValue(null) // no agent key presented
    vi.mocked(authenticateOwner).mockResolvedValueOnce({ wallet: { id: WID } } as never)
    dbMock.authorizationRequest.findUnique.mockResolvedValue(row())
    const res = await evidenceRoute(getReq(null), { params: Promise.resolve({ id: "req_1" }) })
    expect(res.status).toBe(200)
    expect((await res.json()).replay.matches).toBe(true)
  })

  it("exposes a record that no longer reproduces its decision", async () => {
    const tampered = { ...decisionEvidence("spend", SPEND_CTX), effect: "allow", code: undefined }
    dbMock.authorizationRequest.findUnique.mockResolvedValue(row({ decisionContextJson: tampered }))
    const res = await evidenceRoute(getReq(), { params: Promise.resolve({ id: "req_1" }) })
    expect((await res.json()).replay.matches).toBe(false)
  })

  it("handles pre-evidence rows: nulls, no replay", async () => {
    dbMock.authorizationRequest.findUnique.mockResolvedValue(
      row({ policyRevision: null, decisionContextJson: null, decisionNote: "Grant consumed", status: "approved" }),
    )
    const res = await evidenceRoute(getReq(), { params: Promise.resolve({ id: "req_1" }) })
    const body = await res.json()
    expect(body.policy_revision).toBeNull()
    expect(body.decision).toBeNull()
    expect(body.replay).toBeNull()
  })
})
