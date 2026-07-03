import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { hashApiKey } from "../lib/apiKey"

// Management-plane remainder: the approvals inbox route, exec-token revocation,
// the account-tree rollup, and webhook registration (SSRF gate at the route,
// secret shown once). Every write is owner-gated and wallet-scoped — a valid
// key for wallet A must never move wallet B's state.
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    agent: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    wallet: { findUnique: vi.fn(), findMany: vi.fn() },
    executionToken: { updateMany: vi.fn() },
    webhook: { create: vi.fn(), findMany: vi.fn() },
    tokenLog: { groupBy: vi.fn() },
    authorizationRequest: { groupBy: vi.fn() },
  },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("next/server", async (orig) => {
  const mod = await orig<typeof import("next/server")>()
  return { ...mod, after: () => {} }
})
// The resolution machinery is proven in approvals-resolution.test.ts; the route
// test proves the HTTP contract around it.
vi.mock("@/lib/approvals", async (orig) => {
  const mod = await orig<typeof import("@/lib/approvals")>()
  return { ...mod, listPendingApprovals: vi.fn(), resolveApproval: vi.fn() }
})
vi.mock("@/lib/webhooks", async (orig) => {
  const mod = await orig<typeof import("@/lib/webhooks")>()
  return { ...mod, deliverPing: vi.fn(async () => {}) }
})

import { GET as listApprovals, POST as postApproval } from "../app/api/v1/approvals/route"
import { POST as revokeExec } from "../app/api/v1/exec/revoke/route"
import { GET as walletTree } from "../app/api/v1/wallets/tree/route"
import { POST as createWebhook } from "../app/api/v1/webhooks/route"
import { listPendingApprovals, resolveApproval } from "../lib/approvals"

const SK = "sk_testmanagementkey"
const WID = "wallet_1"
const OWNER_WALLET = { id: WID, name: "Acme", parentId: null, mgmtKeyHash: hashApiKey(SK), mgmtKeyPrefix: "sk_testmana" }

function req(method: string, url: string, opts: { headers?: Record<string, string>; body?: unknown } = {}) {
  return new NextRequest("https://test.local" + url, {
    method,
    headers: { "content-type": "application/json", ...(opts.headers ?? {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
}
const mgmtH = { "x-mgmt-key": SK }

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.wallet.findUnique.mockResolvedValue(OWNER_WALLET)
  dbMock.agent.findUnique.mockResolvedValue(null)
})

// ── /v1/approvals ────────────────────────────────────────────────────────────

describe("approvals route — the inbox HTTP contract", () => {
  it("GET 400 without wallet_id, 401 without a key", async () => {
    expect((await listApprovals(req("GET", "/api/v1/approvals"))).status).toBe(400)
    dbMock.wallet.findUnique.mockResolvedValue(null)
    expect((await listApprovals(req("GET", `/api/v1/approvals?wallet_id=${WID}`))).status).toBe(401)
  })

  it("GET lists the pending inbox for the owner", async () => {
    vi.mocked(listPendingApprovals).mockResolvedValue([{ id: "pa_1" }] as never)
    const res = await listApprovals(req("GET", `/api/v1/approvals?wallet_id=${WID}`, { headers: mgmtH }))
    expect(res.status).toBe(200)
    expect((await res.json()).pending).toHaveLength(1)
  })

  it("POST 400 when neither approval_id nor request_id is given", async () => {
    const res = await postApproval(req("POST", "/api/v1/approvals", { headers: mgmtH, body: { wallet_id: WID, decision: "approve" } }))
    expect(res.status).toBe(400)
    expect(resolveApproval).not.toHaveBeenCalled()
  })

  it("POST resolves and echoes approval, request, and grant ids with no-store", async () => {
    vi.mocked(resolveApproval).mockResolvedValue({
      ok: true,
      status: 200,
      approval: { id: "pa_1", status: "approved", resolvedAt: new Date(), resolutionNote: "Approved by owner" },
      grant: { id: "grant_1" },
      request: { id: "req_1", status: "approved", decidedAt: new Date(), decisionNote: "Approved by owner" },
    } as never)
    const res = await postApproval(req("POST", "/api/v1/approvals", { headers: mgmtH, body: { wallet_id: WID, approval_id: "pa_1", decision: "approve" } }))
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect((await res.json())).toMatchObject({ approval_id: "pa_1", request_id: "req_1", grant_id: "grant_1", status: "approved" })
  })

  it("POST surfaces resolver failures with their status (409 double-resolve)", async () => {
    vi.mocked(resolveApproval).mockResolvedValue({ ok: false, error: "Approval already approved", status: 409 } as never)
    const res = await postApproval(req("POST", "/api/v1/approvals", { headers: mgmtH, body: { wallet_id: WID, approval_id: "pa_1", decision: "approve" } }))
    expect(res.status).toBe(409)
  })
})

// ── /v1/exec/revoke ──────────────────────────────────────────────────────────

describe("exec/revoke — owner kills a live execution token", () => {
  it("401 without the owner key", async () => {
    dbMock.wallet.findUnique.mockResolvedValue(null)
    expect((await revokeExec(req("POST", "/api/v1/exec/revoke", { body: { wallet_id: WID, jti: "jti1" } }))).status).toBe(401)
  })

  it("revokes an active token, scoped to this wallet only", async () => {
    dbMock.executionToken.updateMany.mockResolvedValue({ count: 1 })
    const res = await revokeExec(req("POST", "/api/v1/exec/revoke", { headers: mgmtH, body: { wallet_id: WID, jti: "jti1" } }))
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe("revoked")
    // the guarded write carries the wallet scope — jti guessing across tenants gets nothing
    expect(dbMock.executionToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "jti1", walletId: WID, status: "active" } }),
    )
  })

  it("404 when there is no active token with that jti in this wallet", async () => {
    dbMock.executionToken.updateMany.mockResolvedValue({ count: 0 })
    expect((await revokeExec(req("POST", "/api/v1/exec/revoke", { headers: mgmtH, body: { wallet_id: WID, jti: "jti-other" } }))).status).toBe(404)
  })
})

// ── /v1/wallets/tree ─────────────────────────────────────────────────────────

describe("wallets/tree — subtree spend rollup", () => {
  it("rolls child spend up into the parent's subtree totals", async () => {
    dbMock.wallet.findMany
      .mockResolvedValueOnce([{ id: "wallet_child", parentId: WID, name: "Team A" }]) // depth 1
      .mockResolvedValueOnce([]) // depth 2 — done
    dbMock.agent.findMany.mockResolvedValue([
      { id: "agent_root", walletId: WID },
      { id: "agent_child", walletId: "wallet_child" },
    ])
    dbMock.tokenLog.groupBy.mockResolvedValue([])
    dbMock.authorizationRequest.groupBy
      .mockResolvedValueOnce([ // today
        { agentId: "agent_root", _sum: { amountUsd: 10 } },
        { agentId: "agent_child", _sum: { amountUsd: 5 } },
      ])
      .mockResolvedValueOnce([{ agentId: "agent_child", _sum: { amountUsd: 25 } }]) // month

    const res = await walletTree(req("GET", `/api/v1/wallets/tree?wallet_id=${WID}`, { headers: mgmtH }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.nodes).toBe(2)
    expect(body.truncated).toBe(false)
    // own spend vs rolled-up subtree spend
    expect(body.tree.spend.today_usd).toBe(10)
    expect(body.tree.rollup.today_usd).toBe(15) // parent 10 + child 5
    expect(body.tree.children[0].spend.today_usd).toBe(5)
  })
})

// ── /v1/webhooks (POST) ──────────────────────────────────────────────────────

describe("webhooks route — registration", () => {
  it("rejects a non-public URL at the route (SSRF gate) before any auth or write", async () => {
    const res = await createWebhook(req("POST", "/api/v1/webhooks", { headers: mgmtH, body: { wallet_id: WID, url: "https://169.254.169.254/latest" } }))
    expect(res.status).toBe(400)
    expect(dbMock.webhook.create).not.toHaveBeenCalled()
  })

  it("registers a hook: secret shown once, defaults applied, no-store", async () => {
    dbMock.webhook.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "wh_1", ...data }))
    const res = await createWebhook(req("POST", "/api/v1/webhooks", { headers: mgmtH, body: { wallet_id: WID, url: "https://hooks.example.com/sanction" } }))
    expect(res.status).toBe(201)
    expect(res.headers.get("cache-control")).toBe("no-store")
    const body = await res.json()
    expect(body.secret).toMatch(/^whsec_/)
    expect(body.events).toContain("approval.created")
    expect(body.events).toContain("budget.threshold")
  })

  it("rejects an unknown event name", async () => {
    const res = await createWebhook(req("POST", "/api/v1/webhooks", { headers: mgmtH, body: { wallet_id: WID, url: "https://hooks.example.com/s", events: ["nonsense.event"] } }))
    expect(res.status).toBe(400)
  })
})
