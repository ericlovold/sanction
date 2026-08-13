import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { agentKeyFromMcpRequest } from "../lib/mcpRemote"

const { authMock, rateLimitMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  rateLimitMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ authenticateAgent: authMock }))
vi.mock("@/lib/rateLimit", async (orig) => {
  const mod = await orig<typeof import("@/lib/rateLimit")>()
  return { ...mod, rateLimit: rateLimitMock }
})

import { POST as mcpPost } from "../app/mcp/route"

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
