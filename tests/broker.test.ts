import { describe, it, expect, vi, afterEach } from "vitest"

vi.mock("@/lib/db", () => ({ db: { credentialVault: { findFirst: vi.fn() } } }))

import { classifyBrokerBody, brokerRefusalResult, validateUpstreamRegistration, forwardToUpstream, GRANT_META_KEY, type UpstreamConfig } from "../lib/broker"

describe("classifyBrokerBody — the interception boundary", () => {
  it("classifies tools/call with tool, args, and the grant meta", () => {
    const call = classifyBrokerBody({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "github.create_pr", arguments: { title: "x" }, _meta: { [GRANT_META_KEY]: "grant_1" } },
    })
    expect(call).toEqual({ kind: "tools_call", id: 7, tool: "github.create_pr", args: { title: "x" }, grantId: "grant_1" })
  })

  it("everything that is not tools/call passes through", () => {
    for (const method of ["initialize", "tools/list", "resources/list", "ping", "notifications/initialized"]) {
      expect(classifyBrokerBody({ jsonrpc: "2.0", id: 1, method }).kind).toBe("passthrough")
    }
  })

  it("a tools/call with no tool name is invalid, not forwarded", () => {
    expect(classifyBrokerBody({ method: "tools/call", params: {} }).kind).toBe("invalid")
  })

  it("a batch smuggling a tools/call is refused — fail closed, never around", () => {
    const call = classifyBrokerBody([
      { method: "ping", id: 1 },
      { method: "tools/call", id: 2, params: { name: "x" } },
    ])
    expect(call.kind).toBe("invalid")
  })

  it("a batch without tools/call passes through", () => {
    expect(classifyBrokerBody([{ method: "ping", id: 1 }]).kind).toBe("passthrough")
  })
})

describe("brokerRefusalResult — MCP result-with-isError, never a protocol error", () => {
  it("a denial carries code, reason, and remediation", () => {
    const r = brokerRefusalResult(3, {
      status: "denied",
      code: "TOOL_BLOCKED",
      reason: "Tool 'payments.charge' is blocked",
      remediation: "Use an allowed tool.",
    }) as { id: number; result: { isError: boolean; content: { text: string }[] } }
    expect(r.id).toBe(3)
    expect(r.result.isError).toBe(true)
    expect(r.result.content[0].text).toContain("TOOL_BLOCKED")
    expect(r.result.content[0].text).toContain("Use an allowed tool.")
  })

  it("an escalation names the request id and the grant-retry mechanism", () => {
    const r = brokerRefusalResult("a", { status: "escalated", reason: "needs approval", request_id: "req_9" }) as {
      result: { content: { text: string }[] }
    }
    expect(r.result.content[0].text).toContain("req_9")
    expect(r.result.content[0].text).toContain(GRANT_META_KEY)
  })
})

describe("validateUpstreamRegistration", () => {
  const base = { url: "https://mcp.example.com/mcp" }
  it("accepts a public https url and a clean name", () => {
    expect(validateUpstreamRegistration("github", base)).toBeNull()
  })
  it("rejects bad names, non-https, localhost, and lone auth halves", () => {
    expect(validateUpstreamRegistration("Bad Name", base)).toContain("name")
    expect(validateUpstreamRegistration("x", { url: "http://mcp.example.com" })).toContain("https")
    expect(validateUpstreamRegistration("x", { url: "https://localhost:3000/mcp" })).toContain("https")
    expect(validateUpstreamRegistration("x", { ...base, auth_header: "authorization" })).toContain("together")
  })
})

describe("forwardToUpstream never follows redirects (SSRF via redirect)", () => {
  const upstream = { url: "https://mcp.example.com/mcp", auth_header: "authorization", auth_value: "Bearer up-secret" } as UpstreamConfig
  const inbound = { method: "POST", headers: new Headers(), rawBody: "{}" }
  const realFetch = global.fetch
  afterEach(() => {
    global.fetch = realFetch
  })

  it("fetches with redirect: manual", async () => {
    global.fetch = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch
    await forwardToUpstream(upstream, inbound)
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect((init as RequestInit).redirect).toBe("manual")
  })

  it("answers an upstream 3xx as a 502 refusal, never a hop", async () => {
    global.fetch = vi.fn(
      async () => new Response("", { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } }),
    ) as unknown as typeof fetch
    const res = await forwardToUpstream(upstream, inbound)
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe("upstream_redirect")
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })
})
