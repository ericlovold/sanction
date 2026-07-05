import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

// PACK-1: the pack catalog, the 30-day simulation preview, and one-call
// apply. The catalog validity test is the load-bearing one: every shipped
// pack must parse through policyInputSchema — a pack that can't apply
// cleanly must never reach the catalog.
const { dbMock, ownerMock, applyMock, rateLimitMock } = vi.hoisted(() => ({
  dbMock: {
    agent: { findMany: vi.fn() },
    authorizationRequest: { findMany: vi.fn() },
  },
  ownerMock: vi.fn(async () => ({ wallet: { id: "wallet_1" } as unknown })),
  applyMock: vi.fn() as ReturnType<typeof vi.fn>,
  rateLimitMock: vi.fn() as ReturnType<typeof vi.fn>,
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("@/lib/ownerAuth", () => ({ authenticateOwner: ownerMock }))
vi.mock("@/lib/rateLimit", async (orig) => {
  const mod = await orig<typeof import("@/lib/rateLimit")>()
  return { ...mod, rateLimit: rateLimitMock }
})
vi.mock("@/lib/policy", async (orig) => {
  const mod = await orig<typeof import("@/lib/policy")>()
  return { ...mod, applyPolicyUpdate: applyMock }
})

import { policyInputSchema } from "../lib/policy"
import { POLICY_PACKS, findPack } from "../lib/policyPacks"
import { decisionEvidence } from "../lib/evidence"
import { GET as catalog } from "../app/api/v1/policy/packs/route"
import { POST as preview } from "../app/api/v1/policy/packs/[id]/preview/route"
import { POST as apply } from "../app/api/v1/policy/packs/[id]/apply/route"

const WID = "wallet_1"
const params = (id: string) => ({ params: Promise.resolve({ id }) })

function post(path: string, body: unknown) {
  return new NextRequest(`https://test.local${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-mgmt-key": "sk_test" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ownerMock.mockResolvedValue({ wallet: { id: WID } })
  rateLimitMock.mockResolvedValue({ ok: true, limit: 60 })
  applyMock.mockResolvedValue({ ok: true as const, policy: { per_transaction_max_usd: 200 } })
  dbMock.agent.findMany.mockResolvedValue([{ id: "agent_1", name: "tenet" }])
  dbMock.authorizationRequest.findMany.mockResolvedValue([])
})

describe("the catalog itself", () => {
  it("every shipped pack validates against policyInputSchema, ids unique", () => {
    expect(POLICY_PACKS.length).toBeGreaterThanOrEqual(4)
    for (const p of POLICY_PACKS) {
      const parsed = policyInputSchema.safeParse(p.policy)
      expect(parsed.success, `pack '${p.id}' must be a valid policy input`).toBe(true)
    }
    expect(new Set(POLICY_PACKS.map((p) => p.id)).size).toBe(POLICY_PACKS.length)
    expect(findPack("startup-defaults")?.name).toBe("Startup defaults")
    expect(findPack("mcp-tool-governance")?.channel).toBe("mcp")
    expect(findPack("coding-agent-seat")?.useCases).toContain("repository automation")
    expect(findPack("nope")).toBeNull()
  })

  it("GET /v1/policy/packs returns the catalog publicly, rate-limited", async () => {
    const res = await catalog(new NextRequest("https://test.local/api/v1/policy/packs"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.packs.map((p: { id: string }) => p.id)).toContain("compliance-baseline")

    rateLimitMock.mockResolvedValue({ ok: false, retryAfter: 42, limit: 60 })
    const limited = await catalog(new NextRequest("https://test.local/api/v1/policy/packs"))
    expect(limited.status).toBe(429)
    expect(limited.headers.get("retry-after")).toBe("42")
  })
})

describe("POST /v1/policy/packs/{id}/preview", () => {
  it("401s non-owners and 404s unknown packs", async () => {
    ownerMock.mockResolvedValue({ wallet: null })
    expect((await preview(post("/x", { wallet_id: WID }), params("startup-defaults"))).status).toBe(401)
    ownerMock.mockResolvedValue({ wallet: { id: WID } })
    expect((await preview(post("/x", { wallet_id: WID }), params("nope"))).status).toBe(404)
  })

  it("runs the pack through the simulation over a default 30-day window", async () => {
    // $60 spend that was auto-approved; under compliance-baseline's $50
    // per-transaction max it flips to a deny.
    dbMock.authorizationRequest.findMany.mockResolvedValue([
      {
        id: "a1", createdAt: new Date("2026-06-20T12:00:00Z"), agentId: "agent_1",
        action: "purchase", merchant: "vendor", amountUsd: 60, status: "approved",
        decisionContextJson: decisionEvidence("spend", {
          amountUsd: 60, amountCents: 6000, category: "software",
          blockedCategories: [], allowedCategories: [],
          perTxnMaxCents: 10_000, dailySpentUsd: 0, dailyBudgetCents: 20_000,
          monthlySpentUsd: 0, monthlyBudgetCents: null,
          autoApproveUnderCents: 10_000, escalateOverCents: 50_000,
        }),
      },
    ])
    const res = await preview(post("/x", { wallet_id: WID }), params("compliance-baseline"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.pack).toEqual({ id: "compliance-baseline", name: "Compliance baseline", maturity: "evidence" })
    expect(body.state).toBe("as_recorded")
    expect(body.counts).toMatchObject({ simulated: 1, changed: 1 })
    expect(body.changes[0].would).toEqual({ effect: "deny", code: "PER_TXN_LIMIT" })

    const where = dbMock.authorizationRequest.findMany.mock.calls[0][0].where
    const span = where.createdAt.lt.getTime() - where.createdAt.gte.getTime()
    expect(span).toBe(30 * 86_400_000)
  })
})

describe("POST /v1/policy/packs/{id}/apply", () => {
  it("401s non-owners, 404s unknown packs, and never applies on either", async () => {
    ownerMock.mockResolvedValue({ wallet: null })
    expect((await apply(post("/x", { wallet_id: WID }), params("startup-defaults"))).status).toBe(401)
    ownerMock.mockResolvedValue({ wallet: { id: WID } })
    expect((await apply(post("/x", { wallet_id: WID }), params("nope"))).status).toBe(404)
    expect(applyMock).not.toHaveBeenCalled()
  })

  it("applies through applyPolicyUpdate — the revision-writing single write path", async () => {
    const res = await apply(post("/x", { wallet_id: WID }), params("startup-defaults"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.applied).toBe("startup-defaults")
    expect(applyMock).toHaveBeenCalledWith(WID, findPack("startup-defaults")!.policy)
  })

  it("surfaces a validation failure as 400", async () => {
    applyMock.mockResolvedValue({ ok: false as const, error: "Invalid policy" })
    const res = await apply(post("/x", { wallet_id: WID }), params("team-workspace"))
    expect(res.status).toBe(400)
  })
})
