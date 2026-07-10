import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

// AUDIT-1 routes: the tamper-evident export (GET /v1/audit/export) and its
// self-contained verifier (POST /v1/audit/verify). Auth and the DB read are
// mocked; the canonical mapping, chain build, and signature run for real, so
// these tests prove the wire contract end-to-end: what export returns is
// exactly what verify accepts, and a tampered document names its broken link.
const { ownerMock, dbMock } = vi.hoisted(() => ({
  ownerMock: { authenticateOwner: vi.fn() },
  dbMock: {
    db: {
      agent: { findMany: vi.fn() },
      authorizationRequest: { findMany: vi.fn() },
    },
  },
}))
vi.mock("@/lib/ownerAuth", () => ownerMock)
vi.mock("@/lib/db", () => dbMock)

import { GET as exportGET } from "../app/api/v1/audit/export/route"
import { POST as verifyPOST } from "../app/api/v1/audit/verify/route"
import { buildExport, type CanonicalDecision } from "@/lib/auditChain"
import { MAX_EXPORT_ROWS } from "@/lib/auditExport"

const SECRET = "test-signing-secret"

function exportReq(params: string) {
  return new NextRequest(`https://test.local/api/v1/audit/export?${params}`, { method: "GET" })
}

function verifyReq(body: unknown) {
  return new NextRequest("https://test.local/api/v1/audit/verify", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  })
}

function row(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    agentId: "agent_1",
    kind: "spend",
    action: "purchase",
    amountUsd: 10,
    merchant: "aws",
    category: "infrastructure",
    status: "approved",
    decisionNote: null,
    policyRevision: 1,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    decidedAt: new Date("2026-07-01T00:00:01.000Z"),
    ...over,
  }
}

function decision(id: string, over: Partial<CanonicalDecision> = {}): CanonicalDecision {
  return {
    id,
    agent_id: "agent_1",
    kind: "spend",
    action: "purchase",
    amount_usd: 10,
    merchant: "aws",
    category: "infrastructure",
    status: "approved",
    decision_note: null,
    policy_revision: 1,
    created_at: "2026-07-01T00:00:00.000Z",
    decided_at: "2026-07-01T00:00:01.000Z",
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("SANCTION_SIGNING_SECRET", SECRET)
  ownerMock.authenticateOwner.mockResolvedValue({ wallet: { id: "wallet_1" } })
  dbMock.db.agent.findMany.mockResolvedValue([{ id: "agent_1" }])
  dbMock.db.authorizationRequest.findMany.mockResolvedValue([row("req_a"), row("req_b")])
})

describe("GET /v1/audit/export — gates", () => {
  it("400s without wallet_id", async () => {
    const res = await exportGET(exportReq(""))
    expect(res.status).toBe(400)
  })

  it("fails closed with 401 and no DB read without a management key", async () => {
    ownerMock.authenticateOwner.mockResolvedValue({ wallet: null, error: "nope", status: 401 })
    const res = await exportGET(exportReq("wallet_id=wallet_1"))
    expect(res.status).toBe(401)
    expect(dbMock.db.authorizationRequest.findMany).not.toHaveBeenCalled()
  })

  it("503s when signing is not configured (never an unsigned export)", async () => {
    vi.stubEnv("SANCTION_SIGNING_SECRET", "")
    const res = await exportGET(exportReq("wallet_id=wallet_1"))
    expect(res.status).toBe(503)
  })

  it("400s on an invalid date range", async () => {
    const res = await exportGET(exportReq("wallet_id=wallet_1&from=not-a-date&to=2026-07-08"))
    expect(res.status).toBe(400)
  })
})

describe("GET /v1/audit/export — the signed document", () => {
  it("returns a chained, signed export that its own verifier accepts", async () => {
    const res = await exportGET(exportReq("wallet_id=wallet_1&from=2026-07-01&to=2026-07-08"))
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe("no-store")
    const doc = await res.json()
    expect(doc.wallet_id).toBe("wallet_1")
    expect(doc.count).toBe(2)
    expect(doc.chain).toHaveLength(2)
    expect(doc.truncated).toBeUndefined()

    // Round-trip through the real verify route: export output IS verify input.
    const verifyRes = await verifyPOST(verifyReq(doc))
    expect(verifyRes.status).toBe(200)
    const verdict = await verifyRes.json()
    expect(verdict.valid).toBe(true)
  })

  it("download=1 sets attachment headers", async () => {
    const res = await exportGET(exportReq("wallet_id=wallet_1&from=2026-07-01&to=2026-07-08&download=1"))
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="sanction-audit-wallet_1-2026-07-01_2026-07-08.json"',
    )
  })

  it("flags truncation instead of silently capping", async () => {
    dbMock.db.authorizationRequest.findMany.mockResolvedValue(
      Array.from({ length: MAX_EXPORT_ROWS + 1 }, (_, i) => row(`req_${i}`)),
    )
    const res = await exportGET(exportReq("wallet_id=wallet_1&from=2026-07-01&to=2026-07-08"))
    const doc = await res.json()
    expect(doc.truncated).toBe(true)
    expect(doc.count).toBe(MAX_EXPORT_ROWS)
    expect(doc.note_truncated).toContain(String(MAX_EXPORT_ROWS))
  })
})

describe("POST /v1/audit/verify — gates", () => {
  it("400s on a non-JSON body", async () => {
    const res = await verifyPOST(verifyReq("{not json"))
    expect(res.status).toBe(400)
  })

  it("400s on a document that is not a Sanction export", async () => {
    const res = await verifyPOST(verifyReq({ hello: "world" }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("Not a Sanction audit export")
  })

  it("401s without the wallet's management key", async () => {
    ownerMock.authenticateOwner.mockResolvedValue({ wallet: null, error: "nope", status: 401 })
    const doc = buildExport("wallet_1", "2026-07-01", "2026-07-08", [decision("a")], SECRET, "2026-07-09T00:00:00.000Z")
    const res = await verifyPOST(verifyReq(doc))
    expect(res.status).toBe(401)
  })

  it("503s when signing is not configured", async () => {
    vi.stubEnv("SANCTION_SIGNING_SECRET", "")
    const doc = buildExport("wallet_1", "2026-07-01", "2026-07-08", [decision("a")], SECRET, "2026-07-09T00:00:00.000Z")
    const res = await verifyPOST(verifyReq(doc))
    expect(res.status).toBe(503)
  })
})

describe("POST /v1/audit/verify — tamper detection over the wire", () => {
  it("names the first broken link when a decision was altered after signing", async () => {
    const doc = buildExport(
      "wallet_1",
      "2026-07-01",
      "2026-07-08",
      [decision("a"), decision("b"), decision("c")],
      SECRET,
      "2026-07-09T00:00:00.000Z",
    )
    const tampered = {
      ...doc,
      decisions: doc.decisions.map((d) => (d.id === "b" ? { ...d, amount_usd: 9999 } : d)),
    }
    const res = await verifyPOST(verifyReq(tampered))
    expect(res.status).toBe(200)
    const verdict = await res.json()
    expect(verdict.valid).toBe(false)
    expect(verdict.broken_at).toBeDefined()
  })
})
