import { describe, expect, it, vi } from "vitest"
import { readRunnerConfig, runSyntheticApproval, type RunnerDependencies } from "../examples/broker-approval-loop/runner"

const env = { SANCTION_BASE_URL: "https://sanction.example", SANCTION_AGENT_KEY: "pxy_secret", SANCTION_BROKER_UPSTREAM: "fixture" }
const success = { content: [{ type: "text", text: "PRIVATE OUTPUT" }] }
const escalation = { content: [], isError: true, _meta: { "sanction/decision": { status: "escalated", action_type: "tool.invoke", request_id: "request/one" } } }
function harness() {
  const client = { connect: vi.fn().mockResolvedValue(undefined), callTool: vi.fn().mockResolvedValue(success), close: vi.fn().mockResolvedValue(undefined) }
  const transport = { close: vi.fn().mockResolvedValue(undefined) }
  const deps = {
    createClient: vi.fn(() => client), createTransport: vi.fn(() => transport),
    fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({
      request_id: "request/one", status: "approved", grant_status: "active", grant_consumed_at: null,
      grant_id: "PRIVATE GRANT", grant_expires_at: new Date(Date.now() + 60_000).toISOString(),
    }))), log: vi.fn(),
  }
  return { client, transport, deps, run: () => runSyntheticApproval(env, deps as unknown as RunnerDependencies) }
}

describe("synthetic broker host", () => {
  it.each(["https://user:pass@sanction.example", "https://sanction.example?", "https://sanction.example#", "https://sanction.example/api/v1", "http://remote.example", "ftp://localhost", "http://localhost.evil.example"])('rejects unsafe base %s before constructing clients', async base => {
    const h = harness()
    expect(await runSyntheticApproval({ ...env, SANCTION_BASE_URL: base }, h.deps as unknown as RunnerDependencies)).toBe(1)
    expect(h.deps.createClient).not.toHaveBeenCalled()
  })
  it.each(["https://sanction.example", "http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"])("accepts trusted origin %s", base => {
    expect(readRunnerConfig({ ...env, SANCTION_BASE_URL: base }).brokerUrl.pathname).toBe("/mcp/broker/fixture")
  })
  it.each([{ SANCTION_AGENT_KEY: "" }, { SANCTION_AGENT_KEY: "key\nheader" }, { SANCTION_BROKER_UPSTREAM: "../other" }, { SANCTION_BROKER_UPSTREAM: "x".repeat(41) }, { SANCTION_BROKER_UPSTREAM: "" }])("rejects malformed config %j", override => {
    expect(() => readRunnerConfig({ ...env, ...override })).toThrow()
  })
  it("wires trusted broker headers and explicitly labels success without approval", async () => {
    const h = harness()
    expect(await h.run()).toBe(1)
    expect(h.deps.createTransport).toHaveBeenCalledWith(new URL("https://sanction.example/mcp/broker/fixture"), expect.objectContaining({
      requestInit: { headers: { "x-api-key": "pxy_secret" }, redirect: "error" }, fetch: expect.any(Function),
      reconnectionOptions: expect.objectContaining({ maxRetries: 0 }),
    }))
    expect(h.client.connect).toHaveBeenCalledWith(h.transport, { timeout: 15_000 })
    expect(h.client.callTool).toHaveBeenCalledWith({ name: "fixture.echo", arguments: { text: "synthetic test payload" } }, undefined, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(h.deps.fetch).not.toHaveBeenCalled()
    const options = h.deps.createTransport.mock.calls[0] as unknown as [URL, { fetch: typeof fetch }]
    await options[1].fetch("https://sanction.example/mcp/broker/fixture", { method: "GET", redirect: "follow" })
    expect(h.deps.fetch).toHaveBeenCalledWith("https://sanction.example/mcp/broker/fixture", { method: "GET", redirect: "error" })
    expect(h.deps.log.mock.calls.flat().join(" ")).toContain("not proof")
    expect(h.client.close).toHaveBeenCalledOnce()
    expect(h.transport.close).toHaveBeenCalledOnce()
  })
  it("polls with authentication, retries once, and prints neither grants nor raw results", async () => {
    const h = harness()
    h.client.callTool.mockResolvedValueOnce(escalation)
    expect(await h.run()).toBe(0)
    expect(h.deps.fetch).toHaveBeenCalledWith(new URL("https://sanction.example/api/v1/authorize/request%2Fone"), expect.objectContaining({ headers: { "x-api-key": "pxy_secret" }, redirect: "error" }))
    expect(h.client.callTool).toHaveBeenCalledTimes(2)
    expect(h.client.callTool.mock.calls[1][0]).toEqual({ name: "fixture.echo", arguments: { text: "synthetic test payload" }, _meta: { "sanction/grant_id": "PRIVATE GRANT" } })
    expect(h.deps.log.mock.calls.flat().join(" ")).not.toMatch(/pxy_secret|PRIVATE/)
  })
  it.each(["connect", "callTool", "close"] as const)("redacts %s exceptions, returns nonzero, and closes transport", async method => {
    const h = harness()
    h.client[method].mockRejectedValue(new Error("pxy_secret PRIVATE GRANT PRIVATE OUTPUT"))
    expect(await h.run()).toBe(1)
    expect(h.client.close).toHaveBeenCalledOnce()
    expect(h.transport.close).toHaveBeenCalledOnce()
    expect(h.deps.log.mock.calls.flat().join(" ")).not.toMatch(/pxy_secret|PRIVATE/)
  })
  it("stops on failed polling without retrying or logging response text", async () => {
    const h = harness()
    h.client.callTool.mockResolvedValueOnce(escalation)
    h.deps.fetch.mockResolvedValue(new Response("PRIVATE", { status: 403 }))
    expect(await h.run()).toBe(1)
    expect(h.client.callTool).toHaveBeenCalledOnce()
    expect(h.transport.close).toHaveBeenCalledOnce()
    expect(h.deps.log.mock.calls.flat().join(" ")).not.toContain("PRIVATE")
  })
})
