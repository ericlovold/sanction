import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const { authMock, rateLimitMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  rateLimitMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ authenticateAgent: authMock }))
vi.mock("@/lib/rateLimit", async (orig) => {
  const mod = await orig<typeof import("@/lib/rateLimit")>()
  return { ...mod, rateLimit: rateLimitMock }
})

import { GET, POST, DELETE } from "../app/mcp/approvals/route"
import { POST as walletPost } from "../app/mcp/route"

const KEY = "pxy_approvals_test_only"
const URL = "https://getsanction.com/mcp/approvals"
const APPROVAL_TOOLS = [
  "sanction_authorize",
  "sanction_authorize_provision",
  "sanction_authorize_tool",
  "sanction_authorize_capability",
  "sanction_log_tokens",
  "sanction_log_outcome",
  "sanction_wallet_status",
  "sanction_check_authorization",
].sort()
const initialize = {
  jsonrpc: "2.0", id: 1, method: "initialize",
  params: {
    protocolVersion: "2025-03-26", capabilities: {},
    clientInfo: { name: "approvals-route-test", version: "0.0.0" },
  },
}
const toolsList = { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }
const fetchMock = vi.fn()

function request(body: unknown, headers: Record<string, string> = { "x-api-key": KEY }, url = URL) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify(body),
  })
}
function toolCall(name: string, args: Record<string, unknown>) {
  return { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name, arguments: args } }
}
async function listedTools(response: Response) {
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(body.error).toBeUndefined()
  return body.result.tools.map((tool: { name: string }) => tool.name).sort()
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockRejectedValue(new Error("Unexpected external request"))
  rateLimitMock.mockResolvedValue({ ok: true, limit: 120 })
  authMock.mockResolvedValue({ agent: { id: "agt_approvals_test", walletId: "wal_approvals_test", isActive: true }, error: null })
})
afterEach(() => vi.unstubAllGlobals())

describe("/mcp/approvals — isolated hosted tool profile", () => {
  it("initializes with a Bearer agent key and no-store response", async () => {
    const response = await POST(request(initialize, { authorization: `Bearer ${KEY}` }))
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect((await response.json()).result.serverInfo.name).toBe("sanction")
    expect(authMock.mock.calls[0][0].headers.get("x-api-key")).toBe(KEY)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("lists exactly eight tools and leaves subsequent wallet requests at ten", async () => {
    expect(await listedTools(await POST(request(toolsList)))).toEqual(APPROVAL_TOOLS)
    expect(await listedTools(await walletPost(request(toolsList, { "x-api-key": KEY }, "https://getsanction.com/mcp"))))
      .toEqual([...APPROVAL_TOOLS, "sanction_request_execution", "sanction_inject_credential"].sort())
    expect(await listedTools(await POST(request(toolsList)))).toEqual(APPROVAL_TOOLS)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ["sanction_request_execution", { scope: ["TEST_SECRET"], budget_usd: 1 }],
    ["sanction_inject_credential", { jwt: "test-jwt", credential_label: "TEST_SECRET" }],
  ])("rejects direct calls to excluded %s without dispatch", async (name, args) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await POST(request(toolCall(name as string, args as Record<string, unknown>)))
      const body = await response.json()
      // SDKs can represent an unavailable tool as either a JSON-RPC error or a tool error.
      expect(Boolean(body.error || body.result?.isError)).toBe(true)
      expect(JSON.stringify(body)).toContain(`Tool ${name} not found`)
    }
    expect(authMock).toHaveBeenCalledTimes(2)
    for (const [authRequest] of authMock.mock.calls) {
      expect(authRequest.headers.get("x-api-key")).toBe(KEY)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ["missing", {}],
    ["management header", { "x-api-key": "sk_test_management" }],
    ["management Bearer", { authorization: "Bearer sk_test_management" }],
  ])("rejects %s authentication before agent lookup", async (_label, headers) => {
    const response = await POST(request(initialize, headers))
    expect(response.status).toBe(401)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(authMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rejects an invalid agent key", async () => {
    authMock.mockResolvedValue({ agent: null, error: "Invalid API key" })
    const response = await POST(request(initialize))
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ error: "Invalid API key" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([GET, DELETE])("requires authentication for non-POST requests", async (handler) => {
    const response = await handler(new NextRequest(URL, {
      method: handler === GET ? "GET" : "DELETE", headers: { accept: "text/html" },
    }))
    expect(response.status).toBe(401)
    expect(response.headers.get("content-type")).toContain("application/json")
    expect(authMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("enforces the rate limit before authentication", async () => {
    rateLimitMock.mockResolvedValue({ ok: false, retryAfter: 9, limit: 120 })
    const response = await POST(request(initialize))
    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("9")
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(authMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("forwards wallet status with the authenticated wallet and agent key", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      today: { token_cost_usd: 0.1, spend_usd: 1 },
      month: { token_cost_usd: 0.2, spend_usd: 2 }, pending_approvals: 0,
    }), { headers: { "content-type": "application/json" } }))
    const response = await POST(request(toolCall("sanction_wallet_status", { wallet_id: "wal_other" }),
      { "x-api-key": KEY, "x-wallet-id": "wal_other" }, `${URL}?wallet_id=wal_other`))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.error).toBeUndefined()
    expect(body.result.isError).toBeFalsy()
    expect(body.result.content[0].text).toContain("No pending approvals")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://getsanction.com/api/v1/wallets/stats?wallet_id=wal_approvals_test")
    expect(init.method).toBe("GET")
    expect(new Headers(init.headers).get("x-api-key")).toBe(KEY)
  })

  it("ignores query, headers, and JSON-RPC metadata asking for the wallet profile", async () => {
    const headers = { "x-api-key": KEY, "x-mcp-profile": "wallet", "x-sanction-profile": "wallet", "x-tool-profile": "wallet" }
    const url = `${URL}?profile=wallet&toolProfile=wallet`
    const body = { ...toolsList, params: { profile: "wallet", toolProfile: "wallet", _meta: { profile: "wallet", toolProfile: "wallet" } } }
    expect(await listedTools(await POST(request(body, headers, url)))).toEqual(APPROVAL_TOOLS)
    const call = toolCall("sanction_request_execution", { scope: ["TEST_SECRET"], budget_usd: 1, toolProfile: "wallet" })
    const blocked = await POST(request(call, headers, url))
    const result = await blocked.json()
    expect(Boolean(result.error || result.result?.isError)).toBe(true)
    expect(JSON.stringify(result)).toContain("Tool sanction_request_execution not found")
    const malformed = await POST(request({ ...toolsList, toolProfile: "wallet" }, headers, url))
    expect(malformed.status).toBe(400)
    expect((await malformed.json()).error).toBeDefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
