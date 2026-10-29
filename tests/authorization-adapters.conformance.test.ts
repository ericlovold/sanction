import { createServer } from "node:http"
import { resolve } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import vectors from "./fixtures/authorization/adapter-v1.json"

// This suite tests adapter contracts, not policy evaluation or persistence. The
// dispatcher and its identity authentication are real; REST handlers and DB reads
// are boundary doubles returning explicit golden responses, never engine output.
const { dbMock, routes } = vi.hoisted(() => ({
  dbMock: { agent: { findFirst: vi.fn(), update: vi.fn() } },
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

import { createSanctionMcpServer } from "@/lib/mcpServer"
import { dispatchMcpApprovalCall } from "@/lib/mcpApprovalDispatch"
import { internalAgentIdentity } from "@/lib/internalAgentAuth"
import { authenticateAgent } from "@/lib/auth"

const identity = { agentId: "agent_fixture", walletId: "wallet_fixture" }
const cleanups: (() => Promise<void>)[] = []
type Transport = "http" | "internal-dispatch" | "bundled-stdio"
type Seen = { path: string; method: string; body: unknown; authorization: string | null; apiKey: string | null }

beforeEach(() => {
  vi.resetAllMocks()
  dbMock.agent.findFirst.mockResolvedValue({
    id: identity.agentId, walletId: identity.walletId, isActive: true,
    expiresAt: null, lastUsedAt: new Date(), wallet: { policy: {} },
  })
})
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function adapter(transport: Transport, response: unknown, status = 200, failure = false) {
  const seen: Seen[] = []
  const invokedHandlers: string[] = []
  const client = new Client({ name: "authorization-conformance", version: "1.0.0" })
  let apiUrl = "https://unused.invalid/api/v1"
  if (transport === "internal-dispatch") {
    for (const [handlerName, handler] of Object.entries(routes)) {
      handler.mockImplementation(async (request: NextRequest) => {
        invokedHandlers.push(handlerName)
        expect(internalAgentIdentity(request)).toEqual(identity)
        expect(request.headers.get("x-api-key")).toBeNull()
        expect((await authenticateAgent(request)).agent?.id).toBe(identity.agentId)
        seen.push({ path: request.nextUrl.pathname.replace("/api/v1", ""), method: request.method,
          body: request.method === "POST" ? await request.json() : null,
          authorization: request.headers.get("authorization"), apiKey: request.headers.get("x-api-key") })
        if (failure) throw new Error("Fixture transport failure")
        return Response.json(response, { status })
      })
    }
  } else {
    // Loopback HTTP exercises actual fetch and the checked-in package artifact.
    // No credentials or requests leave this process's loopback listener.
    const http = createServer(async (request, reply) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const body = Buffer.concat(chunks).toString()
      seen.push({ path: request.url!.replace("/api/v1", ""), method: request.method!,
        body: body ? JSON.parse(body) : null, authorization: request.headers.authorization ?? null, apiKey: String(request.headers["x-api-key"] ?? "") })
      reply.writeHead(status, { "content-type": failure ? "text/plain" : "application/json" })
      reply.end(failure ? "Fixture non-JSON gateway failure" : JSON.stringify(response))
    })
    await new Promise<void>(resolve => http.listen(0, "127.0.0.1", resolve))
    cleanups.push(() => new Promise<void>((resolve, reject) => {
      http.close(error => error ? reject(error) : resolve())
      http.closeAllConnections()
    }))
    const address = http.address()
    if (!address || typeof address === "string") throw new Error("Missing loopback address")
    apiUrl = `http://127.0.0.1:${address.port}/api/v1`
  }
  cleanups.push(() => client.close())
  if (transport === "bundled-stdio") {
    await client.connect(new StdioClientTransport({
      command: process.execPath, args: [resolve("packages/sanction-mcp/mcp-server.js")],
      env: { SANCTION_API_KEY: "pxy_adapter_fixture", SANCTION_API_URL: apiUrl },
    }))
  } else {
    const server = createSanctionMcpServer({
      apiKey: "pxy_adapter_fixture", apiUrl, toolProfile: "approvals",
      apiCall: transport === "internal-dispatch"
        ? (...args) => dispatchMcpApprovalCall(identity, ...args) : undefined,
    })
    // Close the client before its in-memory peer, including connect failures.
    cleanups.splice(cleanups.length - 1, 0, () => server.close())
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  }
  return { client, seen, invokedHandlers }
}

function assertDecision(result: Awaited<ReturnType<Client["callTool"]>>, expected: object, isError = false) {
  expect(result.isError).toBe(isError)
  expect(result.structuredContent).toEqual(expected)
  const content = result.content as { type: string; text: string }[]
  expect(content).toHaveLength(2)
  expect(JSON.parse(content[1].text)).toEqual(expected)
  const decision = expected as { authorized: boolean; next_action: string }
  expect(content[0].text).toMatch(new RegExp(`^authorized=${decision.authorized} next_action=${decision.next_action}\\.`))
  expect(JSON.stringify(result)).not.toContain("must-not-leak")
}

describe.each<Transport>(["http", "internal-dispatch", "bundled-stdio"])("authorization adapter v1: %s", transport => {
  for (const request of vectors.requests) {
    it.each(vectors.decisions)(`${request.name}: $name`, async decision => {
      const { client, seen, invokedHandlers } = await adapter(transport, decision.response, decision.httpStatus)
      assertDecision(await client.callTool({ name: request.name, arguments: request.arguments }), decision.expected)
      expect(seen).toEqual([{ path: request.path, method: "POST", body: request.body, authorization: request.authorization, apiKey: transport === "internal-dispatch" ? null : "pxy_adapter_fixture" }])
      if (transport === "internal-dispatch") {
        expect(invokedHandlers).toEqual([request.handler])
        expect(dbMock.agent.findFirst).toHaveBeenCalledTimes(2)
        expect(dbMock.agent.findFirst).toHaveBeenCalledWith({
          where: { id: "agent_fixture", walletId: "wallet_fixture" },
          include: { wallet: { include: { policy: true } } },
        })
      }
    })
  }

  it("returns a grant for retry without authorizing execution", async () => {
    const { client, seen, invokedHandlers } = await adapter(transport, vectors.poll.response)
    assertDecision(await client.callTool({ name: vectors.poll.name, arguments: vectors.poll.arguments }), vectors.poll.expected)
    expect(seen).toEqual([{ path: vectors.poll.path, method: "GET", body: null, authorization: null, apiKey: transport === "internal-dispatch" ? null : "pxy_adapter_fixture" }])
    if (transport === "internal-dispatch") {
      expect(invokedHandlers).toEqual([vectors.poll.handler])
      expect(await routes.authorization.mock.calls[0][1].params).toEqual({ id: "request_fixture" })
    }
  })

  it("suppresses stale grants when an authorization check is denied", async () => {
    const { client, seen, invokedHandlers } = await adapter(transport, vectors.deniedPoll.response)
    const result = await client.callTool({ name: vectors.poll.name, arguments: vectors.poll.arguments })
    assertDecision(result, vectors.deniedPoll.expected)
    expect(result.structuredContent).not.toHaveProperty("grant_id")
    expect(JSON.stringify(result)).not.toContain("stale_grant_must_not_leak")
    expect(JSON.stringify(result)).not.toContain("retry_with_grant")
    expect(seen).toEqual([{ path: vectors.poll.path, method: "GET", body: null, authorization: null, apiKey: transport === "internal-dispatch" ? null : "pxy_adapter_fixture" }])
    if (transport === "internal-dispatch") expect(invokedHandlers).toEqual([vectors.poll.handler])
  })

  it("fails closed on malformed decisions", async () => {
    const { client } = await adapter(transport, { authorized: true, status: "denied" })
    assertDecision(await client.callTool({ name: vectors.requests[2].name, arguments: vectors.requests[2].arguments }), {
      authorized: false, status: "error", next_action: "stop", code: "SANCTION_INVALID_RESPONSE",
      reason: "Sanction returned a malformed or contradictory decision.",
      remediation: "Stop and notify the owner. Do not retry automatically.",
    }, true)
  })

  it("fails closed when transport throws or returns a non-JSON gateway response", async () => {
    const { client } = await adapter(transport, {}, 502, true)
    const result = await client.callTool({ name: vectors.requests[2].name, arguments: vectors.requests[2].arguments })
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toMatchObject({ authorized: false, status: "unreachable", next_action: "stop", code: "SANCTION_UNREACHABLE" })
    expect((result.content as { text: string }[])[0].text).toContain("authorized=false next_action=stop.")
  })
})

// Only HTTP carries a response status; internal dispatch returns parsed route data.
// A gateway failure must never turn a success-shaped body into permission.
it.each<Transport>(["http", "bundled-stdio"])("%s rejects approval-shaped HTTP 503", async transport => {
  const { client } = await adapter(transport, { authorized: true, status: "approved" }, 503)
  assertDecision(await client.callTool({ name: vectors.requests[2].name, arguments: vectors.requests[2].arguments }), {
    authorized: false, status: "error", next_action: "stop", code: "SANCTION_HTTP_ERROR",
    reason: "Sanction returned HTTP 503",
    remediation: "Stop and notify the owner. Do not retry automatically.",
  }, true)
})
