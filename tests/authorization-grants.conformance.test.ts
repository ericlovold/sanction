import { describe, expect, it, vi } from "vitest"
import corpus from "./fixtures/authorization/grants-v1.json"

vi.mock("@/lib/db", () => ({ db: {} }))
// Keep real AES-GCM and wallet/label AAD; replace only DB/KMS key lookup.
vi.mock("@/lib/credentialCrypto", async (original) => {
  const mod = await original<typeof import("@/lib/credentialCrypto")>()
  const key = Buffer.alloc(32, 7)
  return {
    ...mod,
    encryptCredentialEnvelope: async (text: string, wallet: string, label: string) => ({
      blob: mod.encryptV3(text, key, wallet, label), keyId: "fixture-key",
    }),
    decryptCredentialEnvelope: async (r: { encryptedValue: string; walletId: string; label: string }) =>
      mod.decryptV3(r.encryptedValue, key, r.walletId, r.label),
  }
})

import { canonicalToolRequest, openToolRequest, sealToolRequest } from "../lib/toolRequest"
import { consumeToolGrant, type ToolGrantRequest } from "../lib/grants"

const now = new Date(corpus.now)
const expiresAt = new Date("2026-07-01T12:15:00.000Z")
const settledRequest = {
  id: "auth_fixture", status: "approved", decisionNote: "Grant consumed",
  amountUsd: 0, merchant: "read", decidedAt: now,
}
type BindingVector = {
  id: string
  approved: ToolGrantRequest
  retry: ToolGrantRequest
  approvedCanonical: string
  retryCanonical: string
  expectedMatch: boolean
  expected: Expected
}
type Expected = {
  ok: boolean
  code: string | null
  status: number | null
  reason: string | null
  write: string
  replay?: { originalRequestId: string; grantId: string }
  auditReason?: string
}
type GrantVector = {
  id: string
  bindingId: string
  grant: Record<string, unknown>
  expected: Expected
  missing?: boolean
  requireHumanApproval?: boolean
  bindingMode?: string
}
const bindings: BindingVector[] = corpus.bindingVectors
const grants: GrantVector[] = corpus.grantVectors

async function prepare(binding: BindingVector, vector?: GrantVector) {
  const requestBinding = await sealToolRequest(
    vector?.bindingMode === "wrong-wallet" ? "other-wallet" : "wallet_fixture", binding.approved,
  )
  if (vector?.bindingMode === "corrupt") requestBinding.encryptedValue = "corrupt"
  if (vector?.bindingMode === "unknown-version") requestBinding.version = 2
  const resourceJson = vector?.bindingMode === "legacy"
    ? { kind: "tool", tool: binding.approved.tool }
    : { kind: "tool", requestBinding }
  const grant = {
    id: "grant_fixture", walletId: "wallet_fixture", agentId: "agent_fixture",
    actionType: "tool.invoke", sourceType: "authorization_request", sourceId: "auth_fixture",
    status: "active", issuedBy: "fixture-owner", resourceJson, expiresAt,
    ...vector?.grant,
  }
  if (typeof grant.expiresAt === "string") grant.expiresAt = new Date(grant.expiresAt)
  const tx = {
    $executeRaw: vi.fn(), $queryRaw: vi.fn(), wallet: { findUnique: vi.fn() },
    executionToken: { findUnique: vi.fn(), update: vi.fn() },
    authorizationRequest: { update: vi.fn().mockResolvedValue(settledRequest) },
    grant: {
      findUnique: vi.fn().mockResolvedValue(vector?.missing ? null : grant),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  }
  const input = {
    grantId: "grant_fixture", walletId: "wallet_fixture", agentId: "agent_fixture",
    request: binding.retry, requireHumanApproval: vector?.requireHumanApproval, now,
  }
  return { tx, grant, input }
}

async function assertConsumption(binding: BindingVector, expected: Expected, vector?: GrantVector) {
  const { tx, grant, input } = await prepare(binding, vector)
  const result = await consumeToolGrant(tx as never, input)
  if (expected.ok) {
    expect(result).toEqual({
      ok: true, request: settledRequest, grantId: "grant_fixture",
      grantExpiresAt: grant.expiresAt, consumedAt: now,
    })
  } else {
    expect(result).toEqual({
      ok: false, code: expected.code, status: expected.status, reason: expected.reason,
      ...(expected.replay ? { replay: expected.replay } : {}),
      ...(expected.auditReason ? { auditReason: expected.auditReason } : {}),
    })
  }
  expect(tx.grant.findUnique).toHaveBeenCalledExactlyOnceWith({ where: { id: "grant_fixture" } })
  if (expected.write === "consume") {
    expect(tx.grant.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: "grant_fixture", status: "active", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      data: { status: "consumed", consumedAt: now },
    })
    expect(tx.authorizationRequest.update).toHaveBeenCalledExactlyOnceWith({
      where: { id: "auth_fixture" },
      data: { status: "approved", decidedAt: now, decisionNote: "Grant consumed" },
    })
  } else {
    expect(tx.authorizationRequest.update).not.toHaveBeenCalled()
    if (expected.write === "expire") {
      expect(tx.grant.updateMany).toHaveBeenCalledExactlyOnceWith({
        where: { id: "grant_fixture", status: "active" }, data: { status: "expired" },
      })
    } else expect(tx.grant.updateMany).not.toHaveBeenCalled()
  }
  expect(tx.executionToken.findUnique).not.toHaveBeenCalled()
  expect(tx.executionToken.update).not.toHaveBeenCalled()
  expect(tx.$executeRaw).not.toHaveBeenCalled()
  expect(tx.$queryRaw).not.toHaveBeenCalled()
  expect(tx.wallet.findUnique).not.toHaveBeenCalled()
}

describe("portable authorization grant vectors v1", () => {
  it("has unique IDs and resolves all binding references", () => {
    expect(corpus.version).toBe(1)
    const ids = [...bindings, ...grants].map((v) => v.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const vector of grants) expect(bindings.some((b) => b.id === vector.bindingId)).toBe(true)
  })

  it("normalizes explicit null server to the missing-server canonical convention", () => {
    const binding = bindings.find((b) => b.id === "missing-arguments-equals-empty-object")!
    expect(canonicalToolRequest({ tool: "read", server: null })).toBe(binding.approvedCanonical)
  })

  for (const binding of bindings) {
    it(`binding: ${binding.id}`, async () => {
      // Compare exact UTF-8 bytes to independent literals, never generated expectations.
      expect(Buffer.from(canonicalToolRequest(binding.approved), "utf8"))
        .toEqual(Buffer.from(binding.approvedCanonical, "utf8"))
      expect(Buffer.from(canonicalToolRequest(binding.retry), "utf8"))
        .toEqual(Buffer.from(binding.retryCanonical, "utf8"))
      const requestBinding = await sealToolRequest("wallet_fixture", binding.approved)
      expect(await openToolRequest("wallet_fixture", { requestBinding })).toBe(binding.approvedCanonical)
      expect(binding.expected.ok).toBe(binding.expectedMatch)
      await assertConsumption(binding, binding.expected)
    })
  }

  for (const vector of grants) {
    it(`consume: ${vector.id}`, async () => {
      const binding = bindings.find((b) => b.id === vector.bindingId)!
      await assertConsumption(binding, vector.expected, vector)
    })
  }

  it("rejects a sequential redemption after the first consumption", async () => {
    // This mock proves replay behavior only. Real transaction races are covered
    // by tests/tool-grant.db.test.ts, not by an in-memory update count.
    const { tx, grant, input } = await prepare(bindings[0])
    tx.grant.updateMany.mockImplementation(async () => {
      grant.status = "consumed"
      return { count: 1 }
    })
    expect((await consumeToolGrant(tx as never, input)).ok).toBe(true)
    expect(await consumeToolGrant(tx as never, input)).toEqual({
      ok: false, code: "GRANT_ALREADY_USED", status: 409, reason: "Grant already consumed",
      replay: { originalRequestId: "auth_fixture", grantId: "grant_fixture" },
    })
    expect(tx.grant.updateMany).toHaveBeenCalledTimes(1)
    expect(tx.authorizationRequest.update).toHaveBeenCalledTimes(1)
  })
})
