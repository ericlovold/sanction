import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { hashApiKey } from "../lib/apiKey"

// Kill switches must reach the credential vault. An execution JWT minted before
// the owner froze the wallet, deactivated the agent, or rotated its key must not
// keep pulling decrypted secrets — inject re-checks agent + freeze state, and
// every kill switch revokes the outstanding execution tokens it strands.
const { dbMock, sessionMock } = vi.hoisted(() => ({
  dbMock: {
    wallet: { findUnique: vi.fn(), update: vi.fn() },
    agent: { findUnique: vi.fn(), update: vi.fn() },
    executionToken: { findUnique: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
    credentialVault: { findFirst: vi.fn() },
    credentialInjection: { create: vi.fn() },
  },
  sessionMock: { requireSessionRole: vi.fn(), setSession: vi.fn() },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("@/lib/rls", () => ({ withTenant: (_w: unknown, fn: (tx: unknown) => unknown) => fn(dbMock) }))
vi.mock("@/lib/session", () => sessionMock)
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
const { jwtMock } = vi.hoisted(() => ({ jwtMock: { verifyExecutionJWT: vi.fn() } }))
vi.mock("@/lib/jwt", () => ({ verifyExecutionJWT: jwtMock.verifyExecutionJWT }))
vi.mock("@/lib/credentialCrypto", () => ({ decryptCredentialEnvelope: vi.fn(async () => "decrypted-secret") }))

import { POST as inject } from "../app/api/v1/credentials/inject/route"
import { POST as freeze } from "../app/api/v1/wallets/freeze/route"
import { POST as rotate } from "../app/api/v1/agents/rotate/route"
import { PATCH as patchAgent } from "../app/api/v1/agents/route"
import { rotateKeyAction, setAgentActiveAction } from "../app/dashboard/keys/actions"

const SK = "sk_testmanagementkey"
const WID = "wallet_1"
const AID = "agent_1"
const OWNER_WALLET = { id: WID, name: "Acme", parentId: null, mgmtKeyHash: hashApiKey(SK), mgmtKeyPrefix: "sk_testmana", frozenAt: null, frozenReason: null }
const AGENT = { id: AID, walletId: WID, name: "bot", holder: null, isActive: true, expiresAt: null as Date | null }

const injectReq = (token = "jwt-token") =>
  new NextRequest("https://test.local/api/v1/credentials/inject", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ credential_label: "SECRET" }),
  })
const mgmtReq = (method: string, path: string, body: unknown) =>
  new NextRequest(`https://test.local/api/v1/${path}`, {
    method,
    headers: { "content-type": "application/json", "x-mgmt-key": SK },
    body: JSON.stringify(body),
  })

const REVOKE_AGENT = { where: { agentId: AID, status: "active" }, data: { status: "revoked", revokedAt: expect.any(Date) } }

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.$transaction.mockImplementation(async (fn: (tx: typeof dbMock) => unknown) => fn(dbMock))
  jwtMock.verifyExecutionJWT.mockResolvedValue({ jti: "exec_1", wallet: WID, agent: AID, scope: ["SECRET"], clearance: 3 })
  dbMock.executionToken.findUnique.mockResolvedValue({ id: "exec_1", agentId: AID, walletId: WID, status: "active", expiresAt: new Date(Date.now() + 3_600_000) })
  dbMock.executionToken.updateMany.mockResolvedValue({ count: 1 })
  dbMock.agent.findUnique.mockResolvedValue(AGENT)
  dbMock.agent.update.mockResolvedValue(AGENT)
  dbMock.wallet.findUnique.mockResolvedValue(OWNER_WALLET)
  dbMock.wallet.update.mockResolvedValue({ id: WID, frozenAt: new Date(), frozenReason: null })
  dbMock.credentialVault.findFirst.mockResolvedValue({ id: "cred_1", walletId: WID, label: "SECRET", type: "api_key", minClearance: 1, revokedAt: null, expiresAt: null })
  sessionMock.requireSessionRole.mockResolvedValue({ id: WID })
})

describe("POST /credentials/inject — kill switches reach the vault", () => {
  it("baseline: a live agent on an unfrozen wallet gets the secret", async () => {
    expect((await inject(injectReq())).status).toBe(200)
  })

  it("403s once the wallet is frozen (KILL-1), before any credential read", async () => {
    dbMock.wallet.findUnique.mockResolvedValue({ ...OWNER_WALLET, frozenAt: new Date(), frozenReason: "incident" })
    const res = await inject(injectReq())
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/frozen/i)
    expect(dbMock.credentialVault.findFirst).not.toHaveBeenCalled()
  })

  it("403s once a parent wallet is frozen", async () => {
    dbMock.wallet.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === WID ? { ...OWNER_WALLET, parentId: "parent" } : { id: "parent", parentId: null, frozenAt: new Date(), frozenReason: null },
    )
    expect((await inject(injectReq())).status).toBe(403)
  })

  it("403s for a deactivated agent", async () => {
    dbMock.agent.findUnique.mockResolvedValue({ ...AGENT, isActive: false })
    const res = await inject(injectReq())
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/inactive/i)
    expect(dbMock.credentialVault.findFirst).not.toHaveBeenCalled()
  })

  it("403s for an expired agent seat", async () => {
    dbMock.agent.findUnique.mockResolvedValue({ ...AGENT, expiresAt: new Date(Date.now() - 1000) })
    const res = await inject(injectReq())
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/expired/i)
  })

  it("403s when the agent has moved to another wallet since the token was minted", async () => {
    dbMock.agent.findUnique.mockResolvedValue({ ...AGENT, walletId: "wallet_elsewhere" })
    const res = await inject(injectReq())
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/moved wallets/i)
    expect(dbMock.credentialVault.findFirst).not.toHaveBeenCalled()
  })

  it("401s (not 500) for a signature-valid JWT with no scope array", async () => {
    jwtMock.verifyExecutionJWT.mockResolvedValue({ jti: "grant_1", wallet: WID })
    const res = await inject(injectReq())
    expect(res.status).toBe(401)
  })
})

describe("kill switches revoke outstanding execution tokens", () => {
  it("POST /wallets/freeze revokes the wallet's active tokens", async () => {
    expect((await freeze(mgmtReq("POST", "wallets/freeze", { wallet_id: WID }))).status).toBe(200)
    expect(dbMock.executionToken.updateMany).toHaveBeenCalledWith({
      where: { walletId: WID, status: "active" },
      data: { status: "revoked", revokedAt: expect.any(Date) },
    })
  })

  it("POST /agents/rotate revokes the agent's active tokens", async () => {
    expect((await rotate(mgmtReq("POST", "agents/rotate", { wallet_id: WID, agent_id: AID }))).status).toBe(200)
    expect(dbMock.executionToken.updateMany).toHaveBeenCalledWith(REVOKE_AGENT)
  })

  it("PATCH /agents active:false revokes; other PATCHes do not", async () => {
    expect((await patchAgent(mgmtReq("PATCH", "agents", { wallet_id: WID, agent_id: AID, active: false }))).status).toBe(200)
    expect(dbMock.executionToken.updateMany).toHaveBeenCalledWith(REVOKE_AGENT)
    dbMock.executionToken.updateMany.mockClear()
    await patchAgent(mgmtReq("PATCH", "agents", { wallet_id: WID, agent_id: AID, active: true }))
    expect(dbMock.executionToken.updateMany).not.toHaveBeenCalled()
  })

  it("dashboard setAgentActiveAction(false) revokes; reactivation does not", async () => {
    const form = (active: string) => {
      const f = new FormData()
      f.set("agent_id", AID)
      f.set("active", active)
      return f
    }
    await setAgentActiveAction(form("false"))
    expect(dbMock.executionToken.updateMany).toHaveBeenCalledWith(REVOKE_AGENT)
    dbMock.executionToken.updateMany.mockClear()
    await setAgentActiveAction(form("true"))
    expect(dbMock.executionToken.updateMany).not.toHaveBeenCalled()
  })

  it("dashboard rotateKeyAction revokes the agent's active tokens", async () => {
    const f = new FormData()
    f.set("agent_id", AID)
    expect((await rotateKeyAction({ ok: false, error: "" }, f)).ok).toBe(true)
    expect(dbMock.executionToken.updateMany).toHaveBeenCalledWith(REVOKE_AGENT)
  })
})
