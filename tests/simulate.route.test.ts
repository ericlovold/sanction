import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

// SIM-1: retro-simulation. Stored evidence + pure ladders + a candidate
// overlay — the route is read+compute only, so the tests prove the overlay
// semantics (what flips, what's out of scope, what's unreplayable) and the
// honesty contract (as_recorded, ignored fields reported, nothing written).
const { dbMock, ownerMock } = vi.hoisted(() => ({
  dbMock: {
    agent: { findMany: vi.fn() },
    authorizationRequest: { findMany: vi.fn() },
  },
  ownerMock: vi.fn(async () => ({ wallet: { id: "wallet_1" } as unknown })),
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("@/lib/ownerAuth", () => ({ authenticateOwner: ownerMock }))

import { decisionEvidence } from "../lib/evidence"
import { POST as simulate } from "../app/api/v1/policy/simulate/route"

const WID = "wallet_1"

// A spend context the ladder auto-approves: $60, $100 already spent of a $200
// daily budget, per-txn max $100, escalation line $500.
const SPEND_ALLOW_CTX = {
  amountUsd: 60, amountCents: 6000, category: "software",
  blockedCategories: [], allowedCategories: [],
  perTxnMaxCents: 10_000, dailySpentUsd: 100, dailyBudgetCents: 20_000,
  monthlySpentUsd: 0, monthlyBudgetCents: null,
  autoApproveUnderCents: 2500, escalateOverCents: 50_000,
}
// A stateless-gate denial: $60 over a $50 per-txn max (counters zeroed, as the
// live gate path records them).
const SPEND_PER_TXN_DENY_CTX = { ...SPEND_ALLOW_CTX, perTxnMaxCents: 5000, dailySpentUsd: 0 }

function row(id: string, evidence: unknown, over: Partial<Record<string, unknown>> = {}) {
  return {
    id, createdAt: new Date("2026-07-03T12:00:00Z"), agentId: "agent_1",
    action: "purchase", merchant: "vendor", amountUsd: 60, status: "approved",
    decisionContextJson: evidence, ...over,
  }
}

function req(body: unknown) {
  return new NextRequest("https://test.local/api/v1/policy/simulate", {
    method: "POST",
    headers: { "content-type": "application/json", "x-mgmt-key": "sk_test" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ownerMock.mockResolvedValue({ wallet: { id: WID } })
  dbMock.agent.findMany.mockResolvedValue([{ id: "agent_1", name: "tenet" }])
  dbMock.authorizationRequest.findMany.mockResolvedValue([])
})

describe("POST /v1/policy/simulate — gate", () => {
  it("401s without the management key (owner-only surface)", async () => {
    ownerMock.mockResolvedValue({ wallet: null })
    const res = await simulate(req({ wallet_id: WID, policy: { daily_spend_budget_usd: 150 } }))
    expect(res.status).toBe(401)
    expect(dbMock.authorizationRequest.findMany).not.toHaveBeenCalled()
  })

  it("400s when no provided field is simulatable, naming the ignored ones", async () => {
    const res = await simulate(req({ wallet_id: WID, policy: { daily_token_budget_usd: 5 } }))
    expect(res.status).toBe(400)
    expect((await res.json()).ignored_fields).toEqual(["daily_token_budget_usd"])
  })

  it("400s a reversed range and malformed JSON", async () => {
    const bad = await simulate(req({ wallet_id: WID, from: "2026-07-04", to: "2026-07-01", policy: { escalate_over_usd: 10 } }))
    expect(bad.status).toBe(400)
    const notJson = new NextRequest("https://test.local/api/v1/policy/simulate", {
      method: "POST", headers: { "x-mgmt-key": "sk_test" }, body: "{",
    })
    expect((await simulate(notJson)).status).toBe(400)
  })
})

describe("POST /v1/policy/simulate — overlay semantics", () => {
  it("reports flips across spend + capability, and counts scope honestly", async () => {
    dbMock.authorizationRequest.findMany.mockResolvedValue([
      row("a", decisionEvidence("spend", SPEND_ALLOW_CTX)), // allow → daily-budget deny
      row("b", decisionEvidence("spend", SPEND_PER_TXN_DENY_CTX), { status: "denied" }), // deny → allow
      row("c", decisionEvidence("capability", { capability: "skill:install:web-scraper", rules: [] }), { amountUsd: 0 }), // allow → escalate
      row("d", { ladder: "tool", effect: "allow", rule_id: "x", ctx: {} }), // valid evidence, unsupported ladder
      row("e", null), // pre-EVID-1 row: no stored context
    ])
    const res = await simulate(
      req({
        wallet_id: WID,
        policy: {
          daily_spend_budget_usd: 150,
          per_transaction_max_usd: 100,
          capability_rules: [{ pattern: "skill:install:*", effect: "escalate" }],
          daily_token_budget_usd: 9, // not simulatable — must be reported, not applied
        },
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.state).toBe("as_recorded")
    expect(body.applied_fields.sort()).toEqual(["capability_rules", "daily_spend_budget_usd", "per_transaction_max_usd"])
    expect(body.ignored_fields).toEqual(["daily_token_budget_usd"])
    expect(body.counts).toEqual({ considered: 5, simulated: 3, changed: 3, out_of_scope: 1, unreplayable: 1 })
    expect(body.totals).toEqual({
      was: { allow: 2, escalate: 0, deny: 1 },
      would: { allow: 1, escalate: 1, deny: 1 },
    })
    // A's $60 was approved; under the candidate B's $60 is instead.
    expect(body.approved_spend_usd).toEqual({ was: 60, would: 60 })

    const byId = Object.fromEntries(body.changes.map((c: { id: string }) => [c.id, c]))
    expect(byId.a.would).toEqual({ effect: "deny", code: "DAILY_BUDGET_EXCEEDED" })
    expect(byId.b.was).toEqual({ effect: "deny", code: "PER_TXN_LIMIT" })
    expect(byId.b.would.effect).toBe("allow")
    expect(byId.c.would).toEqual({ effect: "escalate", code: "CAPABILITY_ESCALATION_REQUIRED" })
    expect(byId.a.final_status).toBe("approved") // what actually happened rides along
  })

  it("an unchanged candidate produces zero flips (determinism, not noise)", async () => {
    dbMock.authorizationRequest.findMany.mockResolvedValue([row("a", decisionEvidence("spend", SPEND_ALLOW_CTX))])
    const body = await (
      await simulate(req({ wallet_id: WID, policy: { per_transaction_max_usd: 100 } }))
    ).json()
    expect(body.counts).toMatchObject({ simulated: 1, changed: 0 })
    expect(body.changes).toEqual([])
    expect(body.approved_spend_usd).toEqual({ was: 60, would: 60 })
  })

  it("defaults to the last 7 days and stays inside the wallet's agents", async () => {
    await simulate(req({ wallet_id: WID, policy: { escalate_over_usd: 10 } }))
    const where = dbMock.authorizationRequest.findMany.mock.calls[0][0].where
    expect(where.agentId).toEqual({ in: ["agent_1"] })
    const span = where.createdAt.lt.getTime() - where.createdAt.gte.getTime()
    expect(span).toBe(7 * 86_400_000)
  })
})
