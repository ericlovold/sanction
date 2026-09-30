import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(), identity: vi.fn(), handle: vi.fn(), dispatch: vi.fn(), rate: vi.fn(), ip: vi.fn(),
  resource: vi.fn(), auth: { api: {} },
}))
vi.mock("@better-auth/mcp", () => ({ requireMcpAuth: mocks.requireAuth }))
vi.mock("@/lib/auth-config", () => ({ auth: mocks.auth }))
vi.mock("@/lib/mcpOAuthProvider", () => ({ mcpOAuthResource: mocks.resource, MCP_APPROVALS_SCOPE: "sanction:approvals" }))
vi.mock("@/lib/mcpOAuthAccess", () => ({ mcpConnectionIdentity: mocks.identity }))
vi.mock("@/lib/mcpRemote", () => ({ handleAuthenticatedMcpRequest: mocks.handle }))
vi.mock("@/lib/mcpApprovalDispatch", () => ({ dispatchMcpApprovalCall: mocks.dispatch }))
vi.mock("@/lib/rateLimit", () => ({ rateLimit: mocks.rate, clientIp: mocks.ip }))
import { handleOAuthMcpRequest } from "@/lib/mcpOAuthRemote"

const claims = { sub: "user_1", client_id: "client_1", sanction_connection_id: "connection_1" }
const identity = { agentId: "agent_1", walletId: "wallet_1" }
function request() {
  return new NextRequest("https://untrusted-host.invalid/mcp/approvals?wallet_id=other&profile=wallet", {
    method: "POST", headers: { authorization: "Bearer outer-oauth-token", "x-api-key": "pxy_untrusted", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  })
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.resource.mockReturnValue("https://getsanction.com/mcp/approvals")
  mocks.rate.mockResolvedValue({ ok: true })
  mocks.ip.mockReturnValue("192.0.2.1")
  mocks.identity.mockResolvedValue(identity)
  mocks.requireAuth.mockImplementation((_auth, callback) => (req: Request) => callback(req, claims))
  mocks.handle.mockResolvedValue(Response.json({ result: {} }))
  mocks.dispatch.mockResolvedValue({ authorized: true })
})

describe("OAuth MCP remote wrapper", () => {
  it("rate limits before provider verification or dispatch", async () => {
    mocks.rate.mockResolvedValue({ ok: false, retryAfter: 17 })
    const response = await handleOAuthMcpRequest(request())
    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("17")
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(mocks.rate).toHaveBeenCalledWith("mcp_hosted", "192.0.2.1", 120, 60)
    expect(mocks.requireAuth).not.toHaveBeenCalled()
    expect(mocks.identity).not.toHaveBeenCalled()
    expect(mocks.handle).not.toHaveBeenCalled()
  })

  it("requires the canonical resource and approvals scope, ignoring request host and profile", async () => {
    await handleOAuthMcpRequest(request())
    expect(mocks.requireAuth).toHaveBeenCalledWith(mocks.auth, expect.any(Function), {
      resource: "https://getsanction.com/mcp/approvals", requiredScopes: ["sanction:approvals"],
    })
    expect(mocks.identity).toHaveBeenCalledWith(claims)
  })

  it.each([401, 403])("preserves provider rejection %s without resolving identity", async (status) => {
    mocks.requireAuth.mockReturnValue(async () => Response.json({ error: "invalid token or scope" }, { status }))
    const response = await handleOAuthMcpRequest(request())
    expect(response.status).toBe(status)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(mocks.identity).not.toHaveBeenCalled()
    expect(mocks.handle).not.toHaveBeenCalled()
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })

  it("returns 401 without dispatch for revoked, mismatched or unauthorized bindings", async () => {
    mocks.identity.mockResolvedValue(null)
    const response = await handleOAuthMcpRequest(request())
    expect(response.status).toBe(401)
    expect(response.headers.get("www-authenticate")).toContain('error="invalid_token"')
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(mocks.handle).not.toHaveBeenCalled()
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })

  it("fixes approvals options and dispatches without the outer OAuth token or inbound agent key", async () => {
    const response = await handleOAuthMcpRequest(request())
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    const [incoming, options] = mocks.handle.mock.calls[0]
    expect(incoming).toBeInstanceOf(NextRequest)
    expect(options).toMatchObject({ apiKey: "", apiUrl: "https://getsanction.com/api/v1", walletId: "wallet_1", toolProfile: "approvals" })
    expect(typeof options.apiCall).toBe("function")
    expect(JSON.stringify(options)).not.toContain("outer-oauth-token")
    expect(JSON.stringify(options)).not.toContain("pxy_untrusted")
    await options.apiCall("/authorize", "POST", { amount_usd: 1 })
    expect(mocks.dispatch).toHaveBeenLastCalledWith(identity, "/authorize", "POST", { amount_usd: 1 })
    const trace = { traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01" }
    await options.apiCall("/authorize", "POST", { amount_usd: 1 }, "explicit-execution-jwt", trace)
    expect(mocks.dispatch).toHaveBeenLastCalledWith(identity, "/authorize", "POST", { amount_usd: 1 }, "explicit-execution-jwt", trace)
  })

  it("does not fall back to inbound agent-key auth on identity lookup failure", async () => {
    mocks.identity.mockRejectedValue(new Error("DB unavailable"))
    await expect(handleOAuthMcpRequest(request())).rejects.toThrow("DB unavailable")
    expect(mocks.handle).not.toHaveBeenCalled()
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })
})
