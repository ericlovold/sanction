import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const { dbMock, routes } = vi.hoisted(() => ({
  dbMock: { agent: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() } },
  routes: {
    authorize: vi.fn(), provision: vi.fn(), tool: vi.fn(), capability: vi.fn(),
    tokens: vi.fn(), outcomes: vi.fn(), stats: vi.fn(), authorization: vi.fn(),
  },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("@/app/api/v1/authorize/route", () => ({ POST: routes.authorize }))
vi.mock("@/app/api/v1/authorize/provision/route", () => ({ POST: routes.provision }))
vi.mock("@/app/api/v1/authorize/tool/route", () => ({ POST: routes.tool }))
vi.mock("@/app/api/v1/authorize/capability/route", () => ({ POST: routes.capability }))
vi.mock("@/app/api/v1/tokens/route", () => ({ POST: routes.tokens }))
vi.mock("@/app/api/v1/outcomes/route", () => ({ POST: routes.outcomes }))
vi.mock("@/app/api/v1/wallets/stats/route", () => ({ GET: routes.stats }))
vi.mock("@/app/api/v1/authorize/[id]/route", () => ({ GET: routes.authorization }))

import { authenticateAgent } from "@/lib/auth"
import { bindInternalAgentIdentity, internalAgentIdentity } from "@/lib/internalAgentAuth"
import { dispatchMcpApprovalCall } from "@/lib/mcpApprovalDispatch"
import { hashApiKey } from "@/lib/apiKey"

const identity = { agentId: "agent_internal", walletId: "wallet_internal" }
const active = { id: identity.agentId, walletId: identity.walletId, isActive: true,
  expiresAt: null, lastUsedAt: new Date(), wallet: { policy: {} } }
const fetchMock = vi.fn()

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockRejectedValue(new Error("Unexpected outbound fetch"))
  dbMock.agent.findFirst.mockResolvedValue(active)
  dbMock.agent.update.mockResolvedValue({})
  for (const route of Object.values(routes)) {
    route.mockImplementation(async (req: NextRequest) => {
      const { agent, error } = await authenticateAgent(req)
      return Response.json(agent ? { authorized: true, agent: agent.id } : { authorized: false, error })
    })
  }
})
afterEach(() => vi.unstubAllGlobals())

describe("approval MCP internal dispatcher", () => {
  it.each([
    ["/authorize", "authorize"], ["/authorize/provision", "provision"],
    ["/authorize/tool", "tool"], ["/authorize/capability", "capability"],
    ["/tokens", "tokens"], ["/outcomes", "outcomes"],
  ] as const)("dispatches POST %s with fresh auth before and inside the handler", async (path, route) => {
    expect(await dispatchMcpApprovalCall(identity, path, "POST", { example: "input" }))
      .toMatchObject({ authorized: true, agent: identity.agentId })
    expect(routes[route]).toHaveBeenCalledOnce()
    expect(dbMock.agent.findFirst).toHaveBeenCalledTimes(2)
    expect(dbMock.agent.findFirst).toHaveBeenCalledWith({
      where: { id: identity.agentId, walletId: identity.walletId },
      include: { wallet: { include: { policy: true } } },
    })
    const request = routes[route].mock.calls[0][0] as NextRequest
    expect(request.url).toBe(`https://sanction.internal/api/v1${path}`)
    expect(request.headers.get("x-api-key")).toBeNull()
    expect(request.headers.get("authorization")).toBeNull()
    expect(await request.json()).toEqual({ example: "input" })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(dbMock.agent.findUnique).not.toHaveBeenCalled()
  })

  it("passes the dynamic authorization id as promised route params", async () => {
    await dispatchMcpApprovalCall(identity, "/authorize/request_123-abc", "GET")
    expect(routes.authorization).toHaveBeenCalledOnce()
    expect(await routes.authorization.mock.calls[0][1].params).toEqual({ id: "request_123-abc" })
  })

  it.each(["/wallets/stats", "/wallets/stats?wallet_id=other&wallet_id=another&scope=subtree"])(
    "forces the bound wallet and drops scope overrides for %s", async (path) => {
      await dispatchMcpApprovalCall(identity, path, "GET")
      const request = routes.stats.mock.calls[0][0] as NextRequest
      expect(request.nextUrl.search).toBe("?wallet_id=wallet_internal")
      expect(internalAgentIdentity(request)).toEqual(identity)
    },
  )

  it.each([
    ["POST", "/exec"], ["POST", "/credentials/inject"], ["GET", "/outcomes"],
    ["POST", "/wallets/stats"], ["GET", "/authorize/tool"],
    ["POST", "/authorize?simulate=true"], ["GET", "/authorize/id?wallet_id=other"],
    ["GET", "/authorize/../wallets"], ["GET", "/authorize/%2e%2e"],
    ["GET", "/authorize/id%2fextra"], ["GET", "/wallets/stats/../exec"],
    ["POST", "https://attacker.invalid/authorize"], ["POST", "//attacker.invalid/authorize"],
    ["DELETE", "/authorize"], ["POST", "/constructor"],
  ])("rejects %s %s before any authentication or handler call", async (method, path) => {
    const result = await dispatchMcpApprovalCall(identity, path, method as "GET" | "POST")
    expect(result).toMatchObject({ authorized: false, code: "MCP_APPROVAL_ROUTE_NOT_ALLOWED" })
    expect(dbMock.agent.findFirst).not.toHaveBeenCalled()
    for (const handler of Object.values(routes)) expect(handler).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    null, { ...active, isActive: false }, { ...active, expiresAt: new Date(0) },
  ])("does not enter a route when the bound identity is unavailable, inactive or expired", async (agent) => {
    dbMock.agent.findFirst.mockResolvedValue(agent)
    expect(await dispatchMcpApprovalCall(identity, "/authorize", "POST", {}))
      .toMatchObject({ authorized: false, code: "UNAUTHORIZED" })
    expect(routes.authorize).not.toHaveBeenCalled()
  })

  it("rechecks inactivity in the route after dispatch preflight", async () => {
    dbMock.agent.findFirst.mockResolvedValueOnce(active).mockResolvedValueOnce({ ...active, isActive: false })
    expect(await dispatchMcpApprovalCall(identity, "/authorize", "POST", {}))
      .toEqual({ authorized: false, error: "Agent is inactive" })
    expect(dbMock.agent.findFirst).toHaveBeenCalledTimes(2)
  })

  it("passes an explicit execution JWT and validated trace only", async () => {
    const traceparent = "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01"
    await dispatchMcpApprovalCall(identity, "/authorize", "POST", {}, "execution-jwt", {
      traceparent, tracestate: "vendor=value", baggage: "invalid\r\nheader: bad",
    })
    const request = routes.authorize.mock.calls[0][0] as NextRequest
    expect(request.headers.get("authorization")).toBe("Bearer execution-jwt")
    expect(request.headers.get("traceparent")).toBe(traceparent)
    expect(request.headers.get("tracestate")).toBe("vendor=value")
    expect(request.headers.get("baggage")).toBeNull()
  })
})

describe("internal identity cannot be supplied by request headers", () => {
  it("rejects forged internal headers and bearer tokens on an unbound request", async () => {
    const request = new NextRequest("https://sanction.internal/api/v1/authorize", { headers: {
      "x-internal-agent-id": identity.agentId, "x-internal-wallet-id": identity.walletId,
      authorization: "Bearer oauth-access-token",
    } })
    expect((await authenticateAgent(request)).agent).toBeNull()
    expect(dbMock.agent.findFirst).not.toHaveBeenCalled()
  })

  it("binds only the exact request and freezes a copy of caller identity", async () => {
    const request = new NextRequest("https://sanction.internal/api/v1/authorize")
    const mutable = { ...identity }
    bindInternalAgentIdentity(request, mutable)
    mutable.walletId = "other"
    expect(internalAgentIdentity(request)).toEqual(identity)
    expect((await authenticateAgent(request)).agent).toEqual(active)
    expect(internalAgentIdentity(request.clone())).toBeUndefined()
    expect((await authenticateAgent(new NextRequest(request))).agent).toBeNull()
    expect(() => bindInternalAgentIdentity(request, mutable)).toThrow("already bound")
  })

  it("does not fall back to a valid raw key when a bound identity has been revoked", async () => {
    const request = new NextRequest("https://sanction.internal/x", { headers: { "x-api-key": "pxy_other" } })
    bindInternalAgentIdentity(request, identity)
    dbMock.agent.findFirst.mockResolvedValue(null)
    dbMock.agent.findUnique.mockResolvedValue(active)
    expect((await authenticateAgent(request)).agent).toBeNull()
    expect(dbMock.agent.findUnique).not.toHaveBeenCalled()
  })

  it("preserves ordinary key hashing, expiry and last-used behavior", async () => {
    const request = new NextRequest("https://sanction.internal/x", { headers: { "x-api-key": "pxy_original" } })
    dbMock.agent.findUnique.mockResolvedValue({ ...active, lastUsedAt: null })
    expect((await authenticateAgent(request)).agent).toBeTruthy()
    expect(dbMock.agent.findUnique).toHaveBeenCalledWith({
      where: { apiKeyHash: hashApiKey("pxy_original") }, include: { wallet: { include: { policy: true } } },
    })
    expect(dbMock.agent.update).toHaveBeenCalledOnce()
    dbMock.agent.findUnique.mockResolvedValue({ ...active, expiresAt: new Date(0) })
    expect((await authenticateAgent(request)).error).toBe("Agent key expired")
    expect(dbMock.agent.findFirst).not.toHaveBeenCalled()
  })
})
