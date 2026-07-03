import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { NextRequest } from "next/server"
import { db } from "../lib/db"

// next/server after() defers work past the response and only runs in a real
// request scope; stub it to a no-op so escalation webhook/email side-effects
// don't run in-test. NextRequest/NextResponse are preserved.
vi.mock("next/server", async (orig) => {
  const mod = await orig<typeof import("next/server")>()
  return { ...mod, after: () => {} }
})

import { POST as createWallet } from "../app/api/v1/wallets/route"
import { POST as createAgent } from "../app/api/v1/agents/route"
import { POST as authorize } from "../app/api/v1/authorize/route"
import { POST as storeCredential } from "../app/api/v1/credentials/vault/route"
import { POST as issueExec } from "../app/api/v1/exec/route"
import { POST as inject } from "../app/api/v1/credentials/inject/route"
import { POST as revokeExec } from "../app/api/v1/exec/revoke/route"
import { POST as resolveApproval } from "../app/api/v1/approvals/route"
import { POST as authorizeTool } from "../app/api/v1/authorize/tool/route"
import { GET as authStatus } from "../app/api/v1/authorize/[id]/route"
import { POST as batchSeats } from "../app/api/v1/agents/batch/route"
import { POST as rotateKey } from "../app/api/v1/agents/rotate/route"

// End-to-end data-plane smoke against a REAL Postgres. Drives the actual route
// handlers through the full lifecycle a customer hits — the cross-module
// regression net that mocked unit tests can't provide (it would have caught the
// exec/inject jti-mismatch P0). Gated; needs DATABASE_URL + the crypto/signing
// env vars (CI provides both).
const run = process.env.RUN_DB_TESTS === "1"

function req(method: string, path: string, opts: { headers?: Record<string, string>; body?: unknown } = {}) {
  return new NextRequest("https://test.local" + path, {
    method,
    headers: { "content-type": "application/json", ...(opts.headers ?? {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
}

describe.skipIf(!run)("e2e: data plane end-to-end (real DB)", () => {
  let walletId = ""
  let mgmtKey = ""
  let apiKey = ""

  beforeAll(async () => {
    const ts = Date.now()
    const w = await (await createWallet(req("POST", "/api/v1/wallets", { body: { name: "E2E", owner_email: `e2e-${ts}@example.com` } }))).json()
    walletId = w.id
    mgmtKey = w.management_key

    // Deterministic policy so the auto-approve / escalate / deny bands are known.
    await db.policy.update({
      where: { walletId },
      data: {
        autoApproveUnderUsd: 1000, // $10
        escalateOverUsd: 5000, // $50
        perTransactionMaxUsd: 10000, // $100
        dailySpendBudgetUsd: 1_000_000,
        allowedCategories: [],
        blockedCategories: ["gambling"],
        escalateTools: ["payments.charge"],
      },
    })

    const a = await (await createAgent(req("POST", "/api/v1/agents", { headers: { "x-mgmt-key": mgmtKey }, body: { wallet_id: walletId, name: "agent" } }))).json()
    apiKey = a.api_key
  })

  afterAll(async () => {
    if (walletId) {
      await db.credentialInjection.deleteMany({ where: { executionToken: { walletId } } })
      await db.executionToken.deleteMany({ where: { walletId } })
      await db.credentialVault.deleteMany({ where: { walletId } })
      await db.authorizationRequest.deleteMany({ where: { agent: { walletId } } })
      await db.agentClearance.deleteMany({ where: { walletId } })
      await db.agent.deleteMany({ where: { walletId } })
      await db.policy.deleteMany({ where: { walletId } })
      await db.wallet.deleteMany({ where: { id: walletId } })
    }
  })

  const agentH = () => ({ "x-api-key": apiKey })
  const mgmtH = () => ({ "x-mgmt-key": mgmtKey })

  it("seeded a wallet + agent with usable keys", () => {
    expect(walletId).toBeTruthy()
    expect(mgmtKey).toMatch(/^sk_/)
    expect(apiKey).toMatch(/^pxy_/)
  })

  it("authorizes a sub-floor spend (approved)", async () => {
    const res = await authorize(req("POST", "/api/v1/authorize", { headers: agentH(), body: { action: "purchase", amount_usd: 5, merchant: "Anthropic", category: "software" } }))
    expect(res.status).toBe(200)
    expect((await res.json()).authorized).toBe(true)
  })

  it("denies a blocked category", async () => {
    const res = await authorize(req("POST", "/api/v1/authorize", { headers: agentH(), body: { action: "purchase", amount_usd: 5, merchant: "X", category: "gambling" } }))
    expect(res.status).toBe(403)
    expect((await res.json()).status).toBe("denied")
  })

  it("credential lifecycle: store → exec → inject (jti round-trip) → revoke → inject fails", async () => {
    const store = await storeCredential(req("POST", "/api/v1/credentials/vault", { headers: mgmtH(), body: { wallet_id: walletId, label: "openai", type: "api_key", value: "sk-secret-xyz" } }))
    expect(store.status).toBe(201)

    const ex = await (await issueExec(req("POST", "/api/v1/exec", { headers: agentH(), body: { scope: ["openai"], budget_usd: 5 } }))).json()
    expect(ex.jwt).toBeTruthy()
    expect(ex.jti).toBeTruthy()

    // The round-trip that would have caught the exec/inject jti-mismatch P0:
    const inj = await inject(req("POST", "/api/v1/credentials/inject", { headers: { authorization: `Bearer ${ex.jwt}` }, body: { credential_label: "openai" } }))
    expect(inj.status).toBe(200)
    expect((await inj.json()).value).toBe("sk-secret-xyz")

    const rev = await revokeExec(req("POST", "/api/v1/exec/revoke", { headers: mgmtH(), body: { wallet_id: walletId, jti: ex.jti } }))
    expect(rev.status).toBe(200)

    const inj2 = await inject(req("POST", "/api/v1/credentials/inject", { headers: { authorization: `Bearer ${ex.jwt}` }, body: { credential_label: "openai" } }))
    expect(inj2.status).toBe(401)
  })

  it("human-in-the-loop: escalation → owner approval", async () => {
    const esc = await authorize(req("POST", "/api/v1/authorize", { headers: agentH(), body: { action: "purchase", amount_usd: 60, merchant: "Vendor", category: "software" } }))
    const ebody = await esc.json()
    expect(ebody.status).toBe("escalated")

    const resolved = await resolveApproval(req("POST", "/api/v1/approvals", { headers: mgmtH(), body: { wallet_id: walletId, request_id: ebody.request_id, decision: "approve" } }))
    expect(resolved.status).toBe(200)
    expect((await resolved.json()).status).toBe("approved")
  })

  it("tool escalation loop: escalate → inbox approval → grant minted → redeem on retry → one-use", async () => {
    const esc = await authorizeTool(req("POST", "/api/v1/authorize/tool", { headers: agentH(), body: { tool: "payments.charge", server: "stripe" } }))
    expect(esc.status).toBe(200)
    const escBody = await esc.json()
    expect(escBody.status).toBe("escalated")
    expect(escBody.request_id).toBeTruthy()

    // The escalated tool call is a persisted AuthorizationRequest — it resolves in
    // the same owner inbox as spend/provision, and approval mints a tool grant.
    const resolved = await resolveApproval(req("POST", "/api/v1/approvals", { headers: mgmtH(), body: { wallet_id: walletId, request_id: escBody.request_id, decision: "approve" } }))
    expect(resolved.status).toBe(200)
    const resolvedBody = await resolved.json()
    expect(resolvedBody.status).toBe("approved")
    expect(resolvedBody.grant_id).toBeTruthy()

    // Polling the request shows the terminal decision + the grant receipt.
    const poll = await authStatus(req("GET", `/api/v1/authorize/${escBody.request_id}`, { headers: agentH() }), { params: Promise.resolve({ id: escBody.request_id }) })
    expect(poll.status).toBe(200)
    const pollBody = await poll.json()
    expect(pollBody.authorized).toBe(true)
    expect(pollBody.grant_id).toBe(resolvedBody.grant_id)

    // Redeem: retry the same tool with grant_id → allowed, grant consumed.
    const redeem = await authorizeTool(req("POST", "/api/v1/authorize/tool", { headers: agentH(), body: { tool: "payments.charge", server: "stripe", grant_id: resolvedBody.grant_id } }))
    expect(redeem.status).toBe(200)
    expect((await redeem.json())).toMatchObject({ authorized: true, status: "allowed", grant_status: "consumed" })

    // One-use: a second redemption refuses.
    const again = await authorizeTool(req("POST", "/api/v1/authorize/tool", { headers: agentH(), body: { tool: "payments.charge", server: "stripe", grant_id: resolvedBody.grant_id } }))
    expect(again.status).toBe(409)
    expect((await again.json()).code).toBe("GRANT_ALREADY_USED")
  })

  it("seats: batch template mints working keys, expiry fails closed, rotate hands the seat over", async () => {
    // Stamp a two-seat template: one live, then push one into the past.
    const batch = await batchSeats(req("POST", "/api/v1/agents/batch", { headers: mgmtH(), body: {
      wallet_id: walletId,
      seats: [{ name: "seat-live", holder: "Ana" }, { name: "seat-gone", holder: "Bo" }],
      template: { daily_spend_budget_usd: 20 },
    } }))
    expect(batch.status).toBe(201)
    const { seats } = await batch.json()
    const [live, gone] = seats

    // A freshly minted seat key authorizes immediately.
    const ok = await authorize(req("POST", "/api/v1/authorize", { headers: { "x-api-key": live.api_key }, body: { action: "purchase", amount_usd: 3, merchant: "Anthropic", category: "software" } }))
    expect(ok.status).toBe(200)

    // Expire the second seat at the database and its key fails closed.
    await db.agent.update({ where: { id: gone.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
    const dead = await authorize(req("POST", "/api/v1/authorize", { headers: { "x-api-key": gone.api_key }, body: { action: "purchase", amount_usd: 3, merchant: "Anthropic", category: "software" } }))
    expect(dead.status).toBe(401)

    // Pass the live seat to a new holder: new key works, old key dies, holder moves.
    const rot = await rotateKey(req("POST", "/api/v1/agents/rotate", { headers: mgmtH(), body: { wallet_id: walletId, agent_id: live.id, holder: "Priya" } }))
    expect(rot.status).toBe(200)
    const rotBody = await rot.json()
    expect(rotBody.holder).toBe("Priya")

    const oldKey = await authorize(req("POST", "/api/v1/authorize", { headers: { "x-api-key": live.api_key }, body: { action: "purchase", amount_usd: 3, merchant: "Anthropic", category: "software" } }))
    expect(oldKey.status).toBe(401)
    const newKey = await authorize(req("POST", "/api/v1/authorize", { headers: { "x-api-key": rotBody.api_key }, body: { action: "purchase", amount_usd: 3, merchant: "Anthropic", category: "software" } }))
    expect(newKey.status).toBe(200)
  })

  it("rejects an unauthenticated data-plane call", async () => {
    const res = await authorize(req("POST", "/api/v1/authorize", { body: { action: "purchase", amount_usd: 5, merchant: "X", category: "software" } }))
    expect(res.status).toBe(401)
  })
})
