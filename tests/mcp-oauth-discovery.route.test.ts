import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  handler: vi.fn(),
}))
vi.mock("@/lib/mcpOAuthProvider", () => ({ mcpOAuthEnabled: mocks.enabled }))
vi.mock("@/lib/auth-config", () => ({ auth: { handler: mocks.handler } }))

import { GET } from "../app/.well-known/[...oauth]/route"

function request(path: string) {
  return new Request(`https://getsanction.com${path}`)
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.enabled.mockReturnValue(true)
  mocks.handler.mockResolvedValue(Response.json({ issuer: "https://getsanction.com/api/auth" }))
})

describe("GET /.well-known OAuth discovery", () => {
  it("forwards the issuer-path authorization-server document unchanged", async () => {
    const response = await GET(request("/.well-known/oauth-authorization-server/api/auth"))
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(mocks.handler).toHaveBeenCalledTimes(1)
    expect(new URL(mocks.handler.mock.calls[0][0].url).pathname)
      .toBe("/.well-known/oauth-authorization-server/api/auth")
  })

  it("serves the same issuer document at the origin authorization-server path", async () => {
    const response = await GET(request("/.well-known/oauth-authorization-server"))
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toMatchObject({ issuer: "https://getsanction.com/api/auth" })
    expect(new URL(mocks.handler.mock.calls[0][0].url).pathname)
      .toBe("/.well-known/oauth-authorization-server/api/auth")
  })

  it.each([
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp/approvals",
  ])("forwards protected-resource metadata at %s", async (path) => {
    const response = await GET(request(path))
    expect(response.status).toBe(200)
    expect(new URL(mocks.handler.mock.calls[0][0].url).pathname).toBe(path)
  })

  it("404s an unknown well-known path without calling the provider", async () => {
    const response = await GET(request("/.well-known/openid-configuration"))
    expect(response.status).toBe(404)
    expect(mocks.handler).not.toHaveBeenCalled()
  })

  it("404s every discovery path when MCP OAuth is disabled", async () => {
    mocks.enabled.mockReturnValue(false)
    const response = await GET(request("/.well-known/oauth-protected-resource/mcp/approvals"))
    expect(response.status).toBe(404)
    expect(mocks.handler).not.toHaveBeenCalled()
  })
})
