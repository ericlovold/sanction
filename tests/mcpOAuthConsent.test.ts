import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  headers: vi.fn(), redirect: vi.fn(), getSession: vi.fn(), oauth2Consent: vi.fn(),
  member: vi.fn(), enabled: vi.fn(), agent: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(),
}))
vi.mock("next/headers", () => ({ headers: mocks.headers }))
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
vi.mock("@/lib/auth-config", () => ({ auth: { api: { getSession: mocks.getSession, oauth2Consent: mocks.oauth2Consent } } }))
vi.mock("@/lib/session", () => ({ getSessionMember: mocks.member }))
vi.mock("@/lib/mcpOAuthProvider", () => ({ mcpOAuthEnabled: mocks.enabled, mcpOAuthResource: () => "http://localhost:3118/mcp/approvals", MCP_APPROVALS_SCOPE: "sanction:approvals" }))
vi.mock("@/lib/db", () => ({ db: {
  agent: { findFirst: mocks.agent },
  mcpOAuthConnection: { create: mocks.create, update: mocks.update, updateMany: mocks.updateMany },
} }))

import { consentMcpConnection, revokeMcpConnection } from "../app/connect/mcp/actions"
import { mcpOAuthConsentContext } from "../lib/mcpOAuthContext"

const signedQuery = "client_id=client&scope=sanction%3Aapprovals+offline_access&redirect_uri=https%3A%2F%2Funtrusted.example%2Fcallback&state=a%2Bb&sig=signature%2B%2F%3D"
const providerUrl = "https://registered.example/callback?code=provider-code"
const redirectSignal = new Error("NEXT_REDIRECT")
const requestHeaders = new Headers({ cookie: "session=example" })
function member(role = "admin", actor = { type: "user", userId: "user" }) {
  return { wallet: { id: "wallet" }, role, actor }
}
function form(overrides: Record<string, string> = {}) {
  const value = new FormData()
  for (const [key, item] of Object.entries({ oauth_query: signedQuery, decision: "allow", agent_id: "agent", ...overrides })) value.set(key, item)
  return value
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.enabled.mockReturnValue(true)
  mocks.headers.mockResolvedValue(requestHeaders)
  mocks.getSession.mockResolvedValue({ user: { id: "user", emailVerified: true } })
  mocks.member.mockResolvedValue(member())
  mocks.agent.mockResolvedValue({ id: "agent", expiresAt: null })
  mocks.create.mockResolvedValue({ id: "connection" })
  mocks.oauth2Consent.mockResolvedValue({ url: providerUrl })
  mocks.redirect.mockImplementation(() => { throw redirectSignal })
})

describe("MCP consent action", () => {
  it.each(["owner", "admin"])("binds a verified %s's signed request to the server-selected connection", async role => {
    mocks.member.mockResolvedValue(member(role))
    mocks.oauth2Consent.mockImplementation(async () => {
      await Promise.resolve()
      expect(mcpOAuthConsentContext.getStore()).toEqual({ connectionId: "connection", userId: "user" })
      return { url: providerUrl }
    })
    await expect(consentMcpConnection(form({ walletId: "foreign", userId: "foreign", connectionId: "foreign", redirect_uri: "https://evil.example" }))).rejects.toBe(redirectSignal)
    expect(mocks.getSession).toHaveBeenCalledWith({ headers: requestHeaders })
    expect(mocks.agent).toHaveBeenCalledWith({ where: { id: "agent", walletId: "wallet", isActive: true }, select: { id: true, expiresAt: true } })
    expect(mocks.create).toHaveBeenCalledWith({ data: { userId: "user", walletId: "wallet", agentId: "agent", clientId: "client" } })
    expect(mocks.oauth2Consent).toHaveBeenCalledWith({ request: expect.any(Request), asResponse: false, headers: requestHeaders, body: { accept: true, oauth_query: signedQuery } })
    const providerRequest = mocks.oauth2Consent.mock.calls[0][0].request as Request
    expect(providerRequest.url).toBe("http://localhost:3118/api/auth/oauth2/consent")
    expect(providerRequest.method).toBe("POST")
    expect(providerRequest.headers.get("cookie")).toBe("session=example")
    expect(mocks.redirect).toHaveBeenCalledWith(providerUrl)
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mcpOAuthConsentContext.getStore()).toBeUndefined()
  })

  it.each([null, { user: { id: "user", emailVerified: false } }])("rejects a missing or unverified provider session", async session => {
    mocks.getSession.mockResolvedValue(session)
    await expect(consentMcpConnection(form())).rejects.toThrow("verified account")
    expect(mocks.member).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.oauth2Consent).not.toHaveBeenCalled()
  })

  it.each([
    ["no membership", null], ["viewer", member("viewer")],
    ["management-key identity", member("owner", { type: "key", userId: "user" })],
    ["different session identity", member("owner", { type: "user", userId: "other-user" })],
  ])("rejects %s before reading agents or creating a connection", async (_label, value) => {
    mocks.member.mockResolvedValue(value)
    await expect(consentMcpConnection(form())).rejects.toThrow("owner or administrator")
    expect(mocks.agent).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.oauth2Consent).not.toHaveBeenCalled()
  })

  it.each([
    "client_id=client&scope=offline_access", "client_id=client&scope=sanction%3Aapprovals+admin",
    "client_id=client", "scope=sanction%3Aapprovals",
  ])("rejects unsupported or missing client/scope: %s", async query => {
    await expect(consentMcpConnection(form({ oauth_query: query }))).rejects.toThrow("Unsupported connection scope")
    expect(mocks.agent).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.oauth2Consent).not.toHaveBeenCalled()
  })

  it.each(["", "x".repeat(16_385)])("rejects an empty or oversized signed query", async query => {
    await expect(consentMcpConnection(form({ oauth_query: query }))).rejects.toThrow("Invalid connection request")
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.oauth2Consent).not.toHaveBeenCalled()
  })

  it.each([null, { id: "agent", expiresAt: new Date(0) }])("rejects missing/inactive/foreign or expired agents", async agent => {
    mocks.agent.mockResolvedValue(agent)
    await expect(consentMcpConnection(form())).rejects.toThrow("active agent in this wallet")
    expect(mocks.agent.mock.calls[0][0].where).toEqual({ id: "agent", walletId: "wallet", isActive: true })
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.oauth2Consent).not.toHaveBeenCalled()
  })

  it("accepts an active agent with future expiry", async () => {
    mocks.agent.mockResolvedValue({ id: "agent", expiresAt: new Date(Date.now() + 60_000) })
    await expect(consentMcpConnection(form())).rejects.toBe(redirectSignal)
    expect(mocks.create).toHaveBeenCalledOnce()
  })

  it("revokes the newly created connection when provider verification fails", async () => {
    mocks.oauth2Consent.mockRejectedValue(new Error("invalid signature with private detail"))
    await expect(consentMcpConnection(form())).rejects.toThrow("Connection request could not be verified. Restart connection from your host.")
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "connection" }, data: { revokedAt: expect.any(Date) } })
    expect(mocks.redirect).not.toHaveBeenCalled()
    expect(mcpOAuthConsentContext.getStore()).toBeUndefined()
  })

  it("denies through the provider without creating a connection or selecting an agent", async () => {
    mocks.oauth2Consent.mockImplementation(async () => {
      expect(mcpOAuthConsentContext.getStore()).toBeUndefined()
      return { url: providerUrl }
    })
    await expect(consentMcpConnection(form({ decision: "deny" }))).rejects.toBe(redirectSignal)
    expect(mocks.oauth2Consent).toHaveBeenCalledWith({ request: expect.any(Request), asResponse: false, headers: requestHeaders, body: { accept: false, oauth_query: signedQuery } })
    expect(mocks.member).not.toHaveBeenCalled()
    expect(mocks.agent).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
    const providerRequest = mocks.oauth2Consent.mock.calls[0][0].request as Request
    expect(providerRequest.url).toBe("http://localhost:3118/api/auth/oauth2/consent")
    expect(providerRequest.method).toBe("POST")
    expect(providerRequest.headers.get("cookie")).toBe("session=example")
    expect(mocks.redirect).toHaveBeenCalledWith(providerUrl)
  })

  it("fails closed when the feature is disabled", async () => {
    mocks.enabled.mockReturnValue(false)
    await expect(consentMcpConnection(form())).rejects.toThrow("not enabled")
    expect(mocks.getSession).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })
})

describe("MCP connection revocation", () => {
  it.each(["owner", "admin"])("scopes revocation to the authenticated %s's wallet", async role => {
    mocks.member.mockResolvedValue(member(role))
    await expect(revokeMcpConnection(form({ connection_id: "target", walletId: "foreign" }))).rejects.toBe(redirectSignal)
    expect(mocks.updateMany).toHaveBeenCalledWith({ where: { id: "target", walletId: "wallet", revokedAt: null }, data: { revokedAt: expect.any(Date) } })
    expect(mocks.redirect).toHaveBeenCalledWith("/connect/mcp")
  })

  it.each([null, member("viewer")])("rejects non-admins before mutation", async value => {
    mocks.member.mockResolvedValue(value)
    await expect(revokeMcpConnection(form({ connection_id: "target" }))).rejects.toThrow("administrator required")
    expect(mocks.updateMany).not.toHaveBeenCalled()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it("fails closed when the feature is disabled", async () => {
    mocks.enabled.mockReturnValue(false)
    await expect(revokeMcpConnection(form())).rejects.toThrow("not enabled")
    expect(mocks.member).not.toHaveBeenCalled()
    expect(mocks.updateMany).not.toHaveBeenCalled()
  })
})
