import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"
import { agentKeyFromMcpRequest, isBrowserMcpProbe } from "../lib/mcpRemote"

const { afterMock, authMock, rateLimitMock, execMock, injectMock, toolMock, tokensMock, outcomesMock } = vi.hoisted(() => ({
  afterMock: vi.fn(),
  authMock: vi.fn(),
  rateLimitMock: vi.fn(),
  execMock: vi.fn(), injectMock: vi.fn(), toolMock: vi.fn(), tokensMock: vi.fn(), outcomesMock: vi.fn(),
}))

vi.mock("next/server", async orig => ({
  ...await orig<typeof import("next/server")>(), after: afterMock,
}))
vi.mock("@/app/api/v1/exec/route", () => ({ POST: execMock }))
vi.mock("@/app/api/v1/credentials/inject/route", () => ({ POST: injectMock }))
vi.mock("@/app/api/v1/authorize/tool/route", () => ({ POST: toolMock }))
vi.mock("@/app/api/v1/tokens/route", () => ({ POST: tokensMock }))
vi.mock("@/app/api/v1/outcomes/route", () => ({ POST: outcomesMock }))
vi.mock("@/lib/auth", () => ({ authenticateAgent: authMock }))
vi.mock("@/lib/rateLimit", async (orig) => {
  const mod = await orig<typeof import("@/lib/rateLimit")>()
  return { ...mod, rateLimit: rateLimitMock }
})

import { GET as mcpGet, POST as mcpPost } from "../app/mcp/route"

const KEY = "pxy_live_agent_key"

function mcpReq(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("https://getsanction.com/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "x-api-key": KEY,
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "hosted-test", version: "0.0.0" },
  },
}

const toolsList = {
  jsonrpc: "2.0",
  id: 2,
  method: "tools/list",
  params: {},
}

beforeEach(() => {
  vi.clearAllMocks()
  rateLimitMock.mockResolvedValue({ ok: true, limit: 120 })
  authMock.mockResolvedValue({
    agent: { id: "agt_1", walletId: "wal_1", isActive: true },
    error: null,
  })
})

describe("isBrowserMcpProbe", () => {
  it("is a GET with text/html and no agent key — not an MCP SSE client", () => {
    expect(
      isBrowserMcpProbe(new Request("https://getsanction.com/mcp", { headers: { accept: "text/html" } })),
    ).toBe(true)
    expect(
      isBrowserMcpProbe(
        new Request("https://getsanction.com/mcp", {
          method: "POST",
          headers: { accept: "text/html" },
        }),
      ),
    ).toBe(false)
    expect(
      isBrowserMcpProbe(
        new Request("https://getsanction.com/mcp", { headers: { accept: "application/json, text/event-stream" } }),
      ),
    ).toBe(false)
    expect(
      isBrowserMcpProbe(
        new Request("https://getsanction.com/mcp", { headers: { accept: "text/html", "x-api-key": KEY } }),
      ),
    ).toBe(false)
  })
})

describe("GET /mcp — browser vs protocol", () => {
  it("serves a paste page to a browser with no key", async () => {
    const req = new NextRequest("https://getsanction.com/mcp", {
      headers: { accept: "text/html,application/xhtml+xml" },
    })
    const res = await mcpGet(req)
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toMatch(/text\/html/)
    const html = await res.text()
    expect(html).toContain("https://getsanction.com/mcp")
    expect(html).toContain("x-api-key")
    expect(html).toContain("Wallet Card")
    expect(rateLimitMock).not.toHaveBeenCalled()
    expect(authMock).not.toHaveBeenCalled()
  })

  it("401s JSON when an MCP client GETs without a key", async () => {
    const req = new NextRequest("https://getsanction.com/mcp", {
      headers: { accept: "application/json, text/event-stream" },
    })
    const res = await mcpGet(req)
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("x-api-key") })
  })
})

describe("agentKeyFromMcpRequest", () => {
  it("accepts x-api-key pxy_ and Bearer pxy_, refuses sk_ and missing", () => {
    expect(agentKeyFromMcpRequest(new Request("https://x", { headers: { "x-api-key": KEY } }))).toBe(KEY)
    expect(
      agentKeyFromMcpRequest(new Request("https://x", { headers: { authorization: `Bearer ${KEY}` } })),
    ).toBe(KEY)
    expect(
      agentKeyFromMcpRequest(new Request("https://x", { headers: { authorization: "Bearer sk_mgmt" } })),
    ).toBeNull()
    expect(agentKeyFromMcpRequest(new Request("https://x"))).toBeNull()
  })
})

describe("POST /mcp — hosted wallet endpoint", () => {
  it("401s without an agent key", async () => {
    const bare = new NextRequest("https://getsanction.com/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify(initialize),
    })
    const res = await mcpPost(bare)
    expect(res.status).toBe(401)
    expect(authMock).not.toHaveBeenCalled()
  })

  it("401s on an invalid agent key", async () => {
    authMock.mockResolvedValue({ agent: null, error: "Invalid API key" })
    const res = await mcpPost(mcpReq(initialize))
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: "Invalid API key" })
  })

  it("429s when the IP is over the public rate limit", async () => {
    rateLimitMock.mockResolvedValue({ ok: false, retryAfter: 9, limit: 120 })
    const res = await mcpPost(mcpReq(initialize))
    expect(res.status).toBe(429)
    expect(res.headers.get("retry-after")).toBe("9")
  })

  it("accepts Authorization Bearer pxy_ and answers initialize", async () => {
    const req = new NextRequest("https://getsanction.com/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${KEY}`,
      },
      body: JSON.stringify(initialize),
    })
    const res = await mcpPost(req)
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("no-store")
    const body = (await res.json()) as { result?: { serverInfo?: { name: string } } }
    expect(body.result?.serverInfo?.name).toBe("sanction")
  })

  it("lists the ten wallet tools on a stateless tools/list", async () => {
    const res = await mcpPost(mcpReq(toolsList))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { result?: { tools?: { name: string }[] }; error?: { message: string } }
    expect(body.error).toBeUndefined()
    expect(body.result?.tools?.map((t) => t.name)).toEqual(
      expect.arrayContaining(["sanction_authorize", "sanction_wallet_status"]),
    )
    expect(body.result?.tools).toHaveLength(10)
  })
})

describe("key-backed MCP tool dispatch", () => {
  const fetchMock = vi.fn()
  const traceparent = "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01"

  async function callTool(name: string, args: Record<string, unknown>) {
    const response = await mcpPost(mcpReq({
      jsonrpc: "2.0", id: 3, method: "tools/call",
      params: { name, arguments: args, _meta: { traceparent } },
    }, { authorization: "Bearer outer-token", "x-mgmt-key": "sk_ignored" }))
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    return (await response.json()).result
  }

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock.mockRejectedValue(new Error("Unexpected outbound request")))
  })
  afterEach(() => vi.unstubAllGlobals())

  it("performs one local tool authorization and preserves its REST decision", async () => {
    toolMock.mockResolvedValueOnce(Response.json({
      authorized: false, status: "denied", code: "TOOL_DENIED", reason: "Denied by policy",
    }, { status: 403 }))
    const result = await callTool("sanction_authorize_tool", { tool: "test.noop" })
    expect(result.structuredContent).toMatchObject({ authorized: false, code: "TOOL_DENIED", next_action: "stop" })
    expect(toolMock).toHaveBeenCalledOnce()
    const [request] = toolMock.mock.calls[0]
    expect(request.url).toBe("https://getsanction.com/api/v1/authorize/tool")
    expect(request.headers.get("x-api-key")).toBe(KEY)
    expect(request.headers.get("authorization")).toBeNull()
    expect(request.headers.get("x-mgmt-key")).toBeNull()
    expect(request.headers.get("traceparent")).toBe(traceparent)
    expect(await request.json()).toEqual({ tool: "test.noop" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("reauthenticates a rotated key inside the spend handler", async () => {
    authMock.mockResolvedValueOnce({ agent: { id: "agt_1", walletId: "wal_1" } })
      .mockResolvedValueOnce({ agent: null, error: "Invalid API key" })
    const result = await callTool("sanction_authorize", { action: "purchase", amount_usd: 1, merchant: "fixture", category: "software" })
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toMatchObject({ authorized: false, next_action: "stop" })
    expect(authMock).toHaveBeenCalledTimes(2)
    expect(authMock.mock.calls[1][0].headers.get("x-api-key")).toBe(KEY)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("dispatches execution and forwards the explicit injection JWT on the wallet profile", async () => {
    execMock.mockResolvedValueOnce(Response.json({ jwt: "issued-jwt", scope: ["TEST_SECRET"] }))
    const execution = await callTool("sanction_request_execution", { scope: ["TEST_SECRET"], budget_usd: 1 })
    expect(JSON.parse(execution.content[0].text).jwt).toBe("issued-jwt")
    const [execReq] = execMock.mock.calls[0]
    expect(execReq.headers.get("x-api-key")).toBe(KEY)
    expect(execReq.headers.get("authorization")).toBeNull()

    injectMock.mockResolvedValueOnce(Response.json({ error: "Token revoked" }, { status: 401 }))
    const injection = await callTool("sanction_inject_credential", { jwt: "issued-jwt", credential_label: "TEST_SECRET" })
    expect(injection.isError).toBe(true)
    const [injectReq] = injectMock.mock.calls[0]
    expect(injectReq.headers.get("authorization")).toBe("Bearer issued-jwt")
    expect(await injectReq.json()).toEqual({ credential_label: "TEST_SECRET" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("returns stop at 15 seconds and keeps a single late write alive", async () => {
    vi.useFakeTimers()
    try {
      let finish!: (response: Response) => void
      let started!: () => void
      const running = new Promise<void>(resolve => { started = resolve })
      toolMock.mockImplementationOnce(() => new Promise<Response>(resolve => {
        finish = resolve
        started()
      }))
      const call = callTool("sanction_authorize_tool", { tool: "test.noop" })
      await running
      await vi.advanceTimersByTimeAsync(14_999)
      expect(afterMock).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      const result = await call
      expect(result.structuredContent).toMatchObject({
        authorized: false, next_action: "stop", code: "SANCTION_UNREACHABLE",
      })
      expect(afterMock).toHaveBeenCalledOnce()
      finish(Response.json({ authorized: true, status: "approved" }))
      await expect(afterMock.mock.calls[0][0]).resolves.toBeInstanceOf(Response)
      expect(result.structuredContent.authorized).toBe(false)
      expect(toolMock).toHaveBeenCalledOnce()
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it("stops on a failed HTTP status, invalid JSON, or a thrown internal error", async () => {
    toolMock.mockResolvedValueOnce(Response.json({ authorized: true, status: "approved" }, { status: 500 }))
      .mockResolvedValueOnce(new Response("invalid JSON"))
      .mockRejectedValueOnce(new Error("sensitive internal detail"))
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await callTool("sanction_authorize_tool", { tool: "test.noop" })
      expect(result.isError).toBe(true)
      expect(result.structuredContent).toMatchObject({ authorized: false, next_action: "stop" })
      expect(JSON.stringify(result)).not.toContain("sensitive internal detail")
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ["sanction_log_tokens", { model: "fixture", tokens_in: 1, tokens_out: 1, cost_usd: 0 }, tokensMock],
    ["sanction_log_outcome", { kind: "fixture" }, outcomesMock],
  ] as const)("refuses an HTTP error receipt from %s", async (name, args, handler) => {
    handler.mockResolvedValueOnce(Response.json({ id: "receipt", recorded: true, deduped: false }, { status: 500 }))
    const result = await callTool(name, args)
    expect(handler).toHaveBeenCalledOnce()
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
