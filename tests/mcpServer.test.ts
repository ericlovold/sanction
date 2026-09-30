import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { resolve } from "node:path"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createSanctionMcpServer } from "../lib/mcpServer"
import discovery from "../public/.well-known/mcp.json"
import registry from "../packages/sanction-mcp/server.json"
import mcpPackage from "../packages/sanction-mcp/package.json"

async function connectedClient() {
  const server = createSanctionMcpServer({
    apiKey: "pxy_test",
    apiUrl: "https://sanction.test/api/v1",
    walletId: "wal_test",
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: "mcp-server-test", version: "0.0.0" })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return { client, server }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("createSanctionMcpServer — tool handlers", () => {
  it("advertises the actual tool surface and both authenticated install transports", async () => {
    const { client, server } = await connectedClient()
    try {
      const { tools } = await client.listTools()
      expect(discovery.tools.map(tool => tool.name).sort()).toEqual(tools.map(tool => tool.name).sort())
      expect(registry.packages[0]).toMatchObject({ identifier: mcpPackage.name, version: mcpPackage.version, transport: { type: "stdio" } })
      expect(registry.remotes).toEqual([{
        type: "streamable-http", url: discovery.url,
        headers: [{ name: "x-api-key", description: expect.any(String), isRequired: true, isSecret: true }],
      }])
      expect(registry.remotes[0].url).toBe("https://getsanction.com/mcp")
      expect(registry.description.length).toBeLessThanOrEqual(100)
      expect(registry.description).toContain("Cooperative")
    } finally {
      await client.close()
      await server.close()
    }
  })

  it("exposes conservative safety hints and matching bundled stdio metadata", async () => {
    const { client, server } = await connectedClient()
    const bundled = new Client({ name: "metadata-parity", version: "0.0.0" })
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    try {
      const { tools } = await client.listTools()
      // Explicit expectations catch accidental read-only classification of grant
      // consumption and expiry settlement, including the latter's GET endpoint.
      const expected = {
        sanction_authorize: [false, true, false, true],
        sanction_authorize_provision: [false, true, false, true],
        sanction_authorize_tool: [false, true, false, true],
        sanction_authorize_capability: [false, true, false, true],
        sanction_log_tokens: [false, false, false, true],
        sanction_log_outcome: [false, false, false, false],
        sanction_request_execution: [false, false, false, false],
        sanction_inject_credential: [false, true, false, false],
        sanction_wallet_status: [true, false, true, false],
        sanction_check_authorization: [false, true, false, false],
      }
      expect(tools).toHaveLength(10)
      expect(Object.fromEntries(tools.map(tool => [tool.name, [
        tool.annotations?.readOnlyHint, tool.annotations?.destructiveHint,
        tool.annotations?.idempotentHint, tool.annotations?.openWorldHint,
      ]]))).toEqual(expected)
      for (const tool of tools) expect(tool.title).toEqual(expect.any(String))
      expect(tools.find(tool => tool.name === "sanction_check_authorization")?.description).toContain("not read-only")
      expect(fetchMock).not.toHaveBeenCalled()

      await bundled.connect(new StdioClientTransport({
        command: process.execPath,
        args: [resolve("packages/sanction-mcp/mcp-server.js")],
        // No real credentials or external API calls are needed for discovery.
        env: { SANCTION_API_KEY: "pxy_metadata_test", SANCTION_API_URL: "http://127.0.0.1:1" },
      }))
      expect((await bundled.listTools()).tools).toEqual(tools)
    } finally {
      await bundled.close()
      await client.close()
      await server.close()
    }
  })

  it("renders approve, escalate, and a bare API error through sanction_authorize", async () => {
    const { client, server } = await connectedClient()
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    fetchMock.mockResolvedValueOnce(jsonResponse({ authorized: true, request_id: "req_ok", grant_status: "consumed" }))
    const ok = (await client.callTool({
      name: "sanction_authorize",
      arguments: { action: "purchase", amount_usd: 4, merchant: "Acme", category: "software" },
    })) as { content: { text: string }[]; isError?: boolean }
    expect(ok.isError).toBeFalsy()
    expect(ok.content[0].text).toMatch(/Authorized.*req_ok.*grant consumed/)

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ authorized: false, status: "escalated", reason: "over the line", request_id: "req_esc" }),
    )
    const esc = (await client.callTool({
      name: "sanction_authorize",
      arguments: { action: "purchase", amount_usd: 80, merchant: "Acme", category: "software" },
    })) as { content: { text: string }[]; isError?: boolean }
    expect(esc.isError).toBe(true)
    expect(esc.content[0].text).toMatch(/ESCALATED.*req_esc/)

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Invalid API key", code: "UNAUTHORIZED" }))
    const bare = (await client.callTool({
      name: "sanction_authorize",
      arguments: { action: "purchase", amount_usd: 1, merchant: "Acme", category: "software" },
    })) as { content: { text: string }[]; isError?: boolean }
    expect(bare.isError).toBe(true)
    expect(bare.content[0].text).toMatch(/UNAUTHORIZED.*not a policy denial/)

    await server.close()
  })

  it("fail-closes when Sanction is unreachable or returns non-JSON", async () => {
    const { client, server } = await connectedClient()
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"))
    const down = (await client.callTool({
      name: "sanction_authorize_tool",
      arguments: { tool: "shell.exec" },
    })) as { content: { text: string }[]; isError?: boolean }
    expect(down.isError).toBe(true)
    expect(down.content[0].text).toMatch(/UNREACHABLE|ECONNRESET/)

    fetchMock.mockResolvedValueOnce(new Response("<html>502</html>", { status: 502 }))
    const html = (await client.callTool({
      name: "sanction_authorize_capability",
      arguments: { capability: "skill:install:web" },
    })) as { content: { text: string }[]; isError?: boolean }
    expect(html.isError).toBe(true)
    expect(html.content[0].text).toMatch(/non-JSON|UNREACHABLE/)

    await server.close()
  })

  it("covers provision, tokens, outcome, exec, inject, status, and grant poll", async () => {
    const { client, server } = await connectedClient()
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    fetchMock.mockResolvedValueOnce(jsonResponse({ authorized: true, request_id: "req_p" }))
    const provision = (await client.callTool({
      name: "sanction_authorize_provision",
      arguments: {
        resource: "azure.seat",
        line_item: "E3",
        quantity: 2,
        amount_usd: 40,
        category: "licenses",
      },
    })) as { content: { text: string }[] }
    expect(provision.content[0].text).toMatch(/Authorized.*E3/)

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
    const tokens = (await client.callTool({
      name: "sanction_log_tokens",
      arguments: { model: "claude-sonnet-4-6", tokens_in: 10, tokens_out: 4, cost_usd: 0.01 },
    })) as { content: { text: string }[] }
    expect(tokens.content[0].text).toMatch(/Logged \$0\.01/)

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "daily token budget exceeded" }))
    const tokenErr = (await client.callTool({
      name: "sanction_log_tokens",
      arguments: { model: "claude-sonnet-4-6", tokens_in: 10, tokens_out: 4, cost_usd: 0.01 },
    })) as { content: { text: string }[]; isError?: boolean }
    expect(tokenErr.isError).toBe(true)

    fetchMock.mockResolvedValueOnce(jsonResponse({ kind: "enrollment", deduped: false }))
    const outcome = (await client.callTool({
      name: "sanction_log_outcome",
      arguments: { kind: "enrollment", dedupe_key: "crm_1" },
    })) as { content: { text: string }[] }
    expect(outcome.content[0].text).toMatch(/Outcome recorded: enrollment/)

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "outcome kind unknown" }))
    const outcomeErr = (await client.callTool({
      name: "sanction_log_outcome",
      arguments: { kind: "nope" },
    })) as { isError?: boolean }
    expect(outcomeErr.isError).toBe(true)

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ jwt: "eyJ", jti: "jti_1", expires_at: "t", clearance: 1, scope: ["STRIPE_KEY"], budget_usd: 5 }),
    )
    const exec = (await client.callTool({
      name: "sanction_request_execution",
      arguments: { scope: ["STRIPE_KEY"], budget_usd: 5 },
    })) as { content: { text: string }[] }
    expect(JSON.parse(exec.content[0].text).jti).toBe("jti_1")

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "wallet frozen" }))
    const execErr = (await client.callTool({
      name: "sanction_request_execution",
      arguments: { scope: ["STRIPE_KEY"], budget_usd: 5 },
    })) as { isError?: boolean }
    expect(execErr.isError).toBe(true)

    fetchMock.mockResolvedValueOnce(jsonResponse({ label: "STRIPE_KEY", type: "secret", value: "sk_x", expires_at: "t" }))
    const inject = (await client.callTool({
      name: "sanction_inject_credential",
      arguments: { jwt: "eyJ", credential_label: "STRIPE_KEY" },
    })) as { content: { text: string }[] }
    expect(JSON.parse(inject.content[0].text).label).toBe("STRIPE_KEY")

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "scope miss" }))
    const injectErr = (await client.callTool({
      name: "sanction_inject_credential",
      arguments: { jwt: "eyJ", credential_label: "NOPE" },
    })) as { isError?: boolean }
    expect(injectErr.isError).toBe(true)

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        today: { token_cost_usd: 0.1, spend_usd: 1 },
        month: { token_cost_usd: 0.2, spend_usd: 2 },
        pending_approvals: 0,
      }),
    )
    const status = (await client.callTool({ name: "sanction_wallet_status", arguments: {} })) as {
      content: { text: string }[]
      isError?: boolean
    }
    expect(status.isError).toBeFalsy()
    expect(status.content[0].text).toMatch(/spend|token|pending/i)

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "unauthorized" }))
    const statusErr = (await client.callTool({ name: "sanction_wallet_status", arguments: {} })) as {
      isError?: boolean
    }
    expect(statusErr.isError).toBe(true)

    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "approved", grant_id: "gr_1" }))
    const pollOk = (await client.callTool({
      name: "sanction_check_authorization",
      arguments: { request_id: "req_1" },
    })) as { content: { text: string }[] }
    expect(pollOk.content[0].text).toMatch(/APPROVED.*gr_1/)

    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "escalated" }))
    const pollWait = (await client.callTool({
      name: "sanction_check_authorization",
      arguments: { request_id: "req_1" },
    })) as { content: { text: string }[] }
    expect(pollWait.content[0].text).toMatch(/awaiting/)

    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "denied", reason: "no" }))
    const pollNo = (await client.callTool({
      name: "sanction_check_authorization",
      arguments: { request_id: "req_1" },
    })) as { content: { text: string }[]; isError?: boolean }
    expect(pollNo.isError).toBe(true)

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "not found" }))
    const pollMiss = (await client.callTool({
      name: "sanction_check_authorization",
      arguments: { request_id: "missing" },
    })) as { isError?: boolean }
    expect(pollMiss.isError).toBe(true)

    await server.close()
  })
})
