import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { hashApiKey } from "../lib/apiKey"

// BROKER-1 route: interception before forwarding, one enforcement shell.
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    agent: { findUnique: vi.fn(), update: vi.fn(async () => ({})) },
    wallet: { findUnique: vi.fn() },
    credentialVault: { findFirst: vi.fn() },
    authorizationRequest: { create: vi.fn(), findUnique: vi.fn() },
    tokenLog: { count: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(async () => 0),
  },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("next/server", async (orig) => {
  const mod = await orig<typeof import("next/server")>()
  return { ...mod, after: () => {} }
})
vi.mock("@/lib/webhooks", async (orig) => {
  const mod = await orig<typeof import("../lib/webhooks")>()
  return { ...mod, deliverEvent: vi.fn(async () => {}), approveUrlFor: (id?: string) => `https://t.local/a?${id}` }
})
vi.mock("@/lib/email", () => ({ sendEscalationEmail: vi.fn(async () => {}) }))
vi.mock("@/lib/approvals", async (orig) => {
  const mod = await orig<typeof import("../lib/approvals")>()
  return { ...mod, createToolPendingApproval: vi.fn(async () => {}) }
})
vi.mock("@/lib/grants", async (orig) => {
  const mod = await orig<typeof import("../lib/grants")>()
  return { ...mod, consumeToolGrant: vi.fn(async () => ({ ok: true, grantId: "grant_1", consumedAt: new Date(), request: { id: "req_g" } })) }
})
vi.mock("@/lib/credentialCrypto", () => ({
  decryptCredentialEnvelope: vi.fn(async () =>
    JSON.stringify({ url: "https://upstream.example.com/mcp", auth_header: "authorization", auth_value: "Bearer upstream-secret" }),
  ),
}))
vi.mock("@/lib/rateLimit", () => ({ clientIp: () => "1.2.3.4", rateLimit: vi.fn(async () => ({ ok: true })) }))

import { POST as brokerPOST } from "../app/mcp/broker/[upstream]/route"

const KEY = "pxy_" + "b".repeat(64)
const AGENT = {
  id: "agent_1",
  walletId: "wallet_1",
  name: "tenet",
  isActive: true,
  lastUsedAt: new Date(),
  expiresAt: null,
  apiKeyHash: hashApiKey(KEY),
  wallet: {
    id: "wallet_1",
    parentId: null,
    ownerEmail: "o@example.com",
    policy: {
      currentRevision: 1,
      blockedTools: ["payments.charge"],
      allowedTools: [],
      escalateTools: ["deploy.production"],
      capabilityRules: [],
      toolConditions: [],
      enforcementMode: "enforce",
      escalationTimeoutMins: 0,
      escalationTimeoutAction: "deny",
    },
  },
}

const ctx = { params: Promise.resolve({ upstream: "github" }) }
const rpc = (method: string, params: Record<string, unknown> = {}, id: number | string = 1) =>
  new NextRequest("https://test.local/mcp/broker/github", {
    method: "POST",
    headers: { "x-api-key": KEY, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  })

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.agent.findUnique.mockResolvedValue(AGENT)
  dbMock.credentialVault.findFirst.mockResolvedValue({ id: "cred_1", walletId: "wallet_1", label: "mcp:github", encryptedValue: "x", keyId: "k" })
  dbMock.authorizationRequest.create.mockResolvedValue({ id: "req_1", createdAt: new Date() })
  dbMock.$transaction.mockImplementation(async (fn: (tx: typeof dbMock) => unknown) => fn(dbMock))
  global.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "upstream says hi" }] } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ) as never
})

describe("/mcp/broker/[upstream] — interception before forwarding", () => {
  it("a blocked tool is refused as an MCP result and the upstream is NEVER called", async () => {
    const res = await brokerPOST(rpc("tools/call", { name: "payments.charge" }, 5), ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe(5)
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0].text).toContain("TOOL_BLOCKED")
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("an escalated tool surfaces the request_id + grant retry path; upstream untouched", async () => {
    const res = await brokerPOST(rpc("tools/call", { name: "deploy.production" }), ctx)
    const body = await res.json()
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0].text).toContain("ESCALATED")
    expect(body.result.content[0].text).toContain("req_1")
    expect(body.result.content[0].text).toContain("sanction/grant_id")
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("an allowed tool forwards — with the vaulted upstream auth and WITHOUT the Sanction key", async () => {
    const res = await brokerPOST(rpc("tools/call", { name: "github.read_file", arguments: { path: "x" } }), ctx)
    const body = await res.json()
    expect(body.result.content[0].text).toBe("upstream says hi")
    expect(global.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe("https://upstream.example.com/mcp")
    const headers = new Headers(init.headers)
    expect(headers.get("authorization")).toBe("Bearer upstream-secret")
    expect(headers.get("x-api-key")).toBeNull() // the invariant
  })

  it("a grant in _meta redeems the approval, then is STRIPPED before forwarding", async () => {
    const res = await brokerPOST(
      rpc("tools/call", { name: "deploy.production", _meta: { "sanction/grant_id": "grant_1" } }),
      ctx,
    )
    const body = await res.json()
    expect(body.result.content[0].text).toBe("upstream says hi")
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const forwarded = JSON.parse(init.body)
    expect(JSON.stringify(forwarded)).not.toContain("grant_1")
    expect(forwarded.params._meta).toBeUndefined()
  })

  it("initialize and tools/list pass through untouched", async () => {
    const res = await brokerPOST(rpc("tools/list"), ctx)
    expect(res.status).toBe(200)
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it("an unregistered upstream is 404 with the registration pointer", async () => {
    dbMock.credentialVault.findFirst.mockResolvedValue(null)
    const res = await brokerPOST(rpc("tools/call", { name: "x" }), ctx)
    expect(res.status).toBe(404)
    expect((await res.json()).error).toContain("broker/upstreams")
  })

  it("no agent key → 401 before anything else", async () => {
    const res = await brokerPOST(
      new NextRequest("https://test.local/mcp/broker/github", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
      ctx,
    )
    expect(res.status).toBe(401)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("a batched tools/call is refused, not smuggled", async () => {
    const res = await brokerPOST(
      new NextRequest("https://test.local/mcp/broker/github", {
        method: "POST",
        headers: { "x-api-key": KEY, "content-type": "application/json" },
        body: JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "x" } }]),
      }),
      ctx,
    )
    expect(res.status).toBe(400)
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
