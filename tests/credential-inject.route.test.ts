import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

// Route-level tests for POST /credentials/inject — the guard/engine boundary.
// Token-layer auth (JWT, audience, execution-token, scope) are capability guards
// that must run BEFORE the engine's credential.use decision. These lock that
// ordering in so a future refactor can't silently fold scope into policy.
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    executionToken: { findUnique: vi.fn() },
    credentialVault: { findFirst: vi.fn() },
    credentialInjection: { create: vi.fn() },
  },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
// Unit tests exercise route logic; real RLS isolation is proven by tests/rls.db.test.ts
// against actual Postgres. Here withTenant just hands the handler the mocked client.
vi.mock("@/lib/rls", () => ({ withTenant: (_w: unknown, fn: (tx: unknown) => unknown) => fn(dbMock) }))

const { jwtMock } = vi.hoisted(() => ({ jwtMock: { verifyExecutionJWT: vi.fn() } }))
vi.mock("@/lib/jwt", () => ({ verifyExecutionJWT: jwtMock.verifyExecutionJWT }))
vi.mock("@/lib/credentialCrypto", () => ({ decryptCredentialEnvelope: vi.fn(async () => "decrypted-secret") }))

import { POST as inject } from "../app/api/v1/credentials/inject/route"

const req = (body: unknown, token = "jwt-token") =>
  new NextRequest("https://test.local/api/v1/credentials/inject", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })

const claims = (over: Record<string, unknown> = {}) => ({ jti: "exec_1", wallet: "wallet_1", scope: ["SECRET"], clearance: 3, ...over })
const cred = (over: Record<string, unknown> = {}) => ({ id: "cred_1", walletId: "wallet_1", label: "SECRET", type: "api_key", minClearance: 1, revokedAt: null, expiresAt: null, ...over })

beforeEach(() => {
  vi.clearAllMocks()
  jwtMock.verifyExecutionJWT.mockResolvedValue(claims())
  dbMock.executionToken.findUnique.mockResolvedValue({ id: "exec_1", status: "active", expiresAt: new Date(Date.now() + 3_600_000) })
  dbMock.credentialVault.findFirst.mockResolvedValue(cred())
})

describe("POST /credentials/inject — guard/engine boundary", () => {
  it("an out-of-scope credential fails at the scope guard, BEFORE credential-policy evaluation", async () => {
    jwtMock.verifyExecutionJWT.mockResolvedValue(claims({ scope: ["OTHER"] }))
    const res = await inject(req({ credential_label: "SECRET" }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: "'SECRET' not in JWT scope" })
    // The boundary: never reached the credential lookup or the engine decision.
    expect(dbMock.credentialVault.findFirst).not.toHaveBeenCalled()
    expect(dbMock.credentialInjection.create).not.toHaveBeenCalled()
  })

  it("permits an in-scope, sufficiently-cleared credential and honors both obligations", async () => {
    const res = await inject(req({ credential_label: "SECRET" }))
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("no-store") // no_store obligation
    expect(dbMock.credentialInjection.create).toHaveBeenCalledOnce() // audit_log obligation
    expect((await res.json()).value).toBe("decrypted-secret")
  })

  it("denies a revoked credential through the engine (410) and writes no audit", async () => {
    dbMock.credentialVault.findFirst.mockResolvedValue(cred({ revokedAt: new Date() }))
    const res = await inject(req({ credential_label: "SECRET" }))
    expect(res.status).toBe(410)
    expect(await res.json()).toEqual({ error: "Credential has been retired" })
    expect(dbMock.credentialInjection.create).not.toHaveBeenCalled() // deny → no obligations
  })
})
