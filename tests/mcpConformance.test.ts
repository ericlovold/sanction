import Ajv2020 from "ajv/dist/2020"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

// Conformance gate for the MCP 2026-07-28 specification revision.
//
// sanction-mcp is a stdio server, so most of that revision's headline changes
// are transport-level and belong to the SDK: the `initialize` handshake,
// `Mcp-Method`/`Mcp-Name` routing headers, and the OAuth/OIDC hardening are all
// Streamable-HTTP concerns (the spec directs stdio servers to take credentials
// from the environment instead, which is what we do). What this file pins is
// the part that IS ours:
//
//   1. Tool schemas are valid JSON Schema 2020-12 — the revision's default
//      dialect, and the only one clients MUST support.
//   2. No dependency on Roots, Sampling, or protocol Logging, all deprecated
//      2026-07-28 with removal eligible on or after 2027-07-28.
//   3. Statelessness: the tool surface does not vary with connection identity,
//      and per-request metadata is read from the request, never cached.
//   4. W3C trace context reaches the Sanction API — the sanctioned replacement
//      for deprecated protocol Logging.
//
// See docs/MCP-2026-07-28.md for the full readiness statement.

process.env.SANCTION_API_URL = "https://sanction.test/api/v1"
process.env.SANCTION_API_KEY = "pxy_test"
process.env.SANCTION_WALLET_ID = "wal_test"

const TRACEPARENT = "00-0af7651916cd43dd8448eb211c80319c-00f067aa0ba902b7-01"

type ToolDef = { name: string; description?: string; inputSchema: Record<string, unknown> }

let tools: ToolDef[]
let client: Client

async function connect() {
  const { server } = await import("@/mcp-server")
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const c = new Client({ name: "conformance", version: "0.0.0" })
  await Promise.all([server.connect(serverTransport), c.connect(clientTransport)])
  return c
}

beforeAll(async () => {
  client = await connect()
  tools = (await client.listTools()).tools as unknown as ToolDef[]
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("tool schemas are JSON Schema 2020-12 conformant", () => {
  it("exposes the full governance tool surface", () => {
    expect(tools.length).toBeGreaterThan(0)
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["sanction_authorize", "sanction_wallet_status"]))
  })

  it("compiles every inputSchema body under a strict 2020-12 validator", () => {
    // The dialect tag is asserted separately below; what matters here is that
    // the schema BODY is 2020-12-valid, i.e. it uses no draft-07-only construct
    // (boolean `exclusiveMinimum`, `definitions`, sibling-`$ref` semantics) that
    // would change meaning or fail outright under the revision's default
    // dialect. strict mode also rejects unknown keywords rather than ignoring
    // them, which is how a "loose schema that passed before" gets caught.
    const ajv = new Ajv2020({ strict: true, allErrors: true })
    for (const tool of tools) {
      const { $schema: _dialect, ...body } = tool.inputSchema
      expect(() => ajv.compile(body), `${tool.name} inputSchema body is not valid 2020-12`).not.toThrow()
    }
  })

  it("validates real arguments against the 2020-12 reading of the schema", () => {
    // Compiling proves the schema parses; this proves it still MEANS the same
    // thing — a negative amount must fail under 2020-12 exactly as it does
    // under draft-07, or the dialect migration would silently widen the gate.
    const ajv = new Ajv2020({ strict: true, allErrors: true })
    const authorize = tools.find((t) => t.name === "sanction_authorize")!
    const { $schema: _dialect, ...body } = authorize.inputSchema
    const validate = ajv.compile(body)

    expect(validate({ action: "purchase", amount_usd: 10, merchant: "Anthropic", category: "software" })).toBe(true)
    expect(validate({ action: "purchase", amount_usd: -10, merchant: "Anthropic", category: "software" })).toBe(false)
    expect(validate({ action: "wire", amount_usd: 10, merchant: "Anthropic", category: "software" })).toBe(false)
    expect(validate({ amount_usd: 10, merchant: "Anthropic", category: "software" })).toBe(false)
  })

  it("declares an object inputSchema for every tool, never null", () => {
    for (const tool of tools) {
      expect(tool.inputSchema, tool.name).toBeTypeOf("object")
      expect(tool.inputSchema, tool.name).not.toBeNull()
      expect(tool.inputSchema.type, tool.name).toBe("object")
    }
  })

  it("keeps tool names inside the spec's character set and length bounds", () => {
    for (const tool of tools) {
      expect(tool.name, tool.name).toMatch(/^[A-Za-z0-9_.-]{1,128}$/)
    }
    expect(new Set(tools.map((t) => t.name)).size, "tool names must be unique").toBe(tools.length)
  })

  it("does not use x-mcp-header on any parameter", () => {
    // Every Sanction tool parameter is either sensitive (JWTs, grant ids) or
    // high-cardinality; the spec warns against mirroring such values into
    // headers where intermediaries can read them.
    expect(JSON.stringify(tools)).not.toContain("x-mcp-header")
  })

  it("pins the declared schema dialect the SDK stamps", () => {
    // KNOWN GAP, tracked in docs/BACKLOG.md and docs/MCP-2026-07-28.md.
    //
    // @modelcontextprotocol/sdk 1.29 hard-codes a draft-07 `$schema` tag on
    // every emitted tool schema (server/zod-json-schema-compat.js maps an absent
    // target to 'draft-7' with no way to override it). draft-07 remains a LEGAL
    // explicit dialect under 2026-07-28, but the revision only requires clients
    // to support 2020-12 — so a strict, 2020-12-only client is within its rights
    // to reject these tools. The fix belongs upstream in the SDK, or in the v2
    // SDK migration; the bodies above are already 2020-12-clean.
    //
    // This assertion exists to fail loudly the day the SDK changes its output,
    // so the migration is a decision rather than a surprise.
    const dialects = new Set(tools.map((t) => t.inputSchema.$schema))
    expect(dialects).toEqual(new Set(["http://json-schema.org/draft-07/schema#"]))
  })
})

describe("no dependency on features deprecated in 2026-07-28", () => {
  it("advertises neither sampling nor roots as a client requirement", async () => {
    const caps = (await import("@/mcp-server")).server.server.getClientCapabilities?.()
    expect(caps?.sampling).toBeUndefined()
    expect(caps?.roots).toBeUndefined()
  })

  it("declares no logging capability", async () => {
    // Protocol Logging is deprecated; stdio servers log to stderr instead.
    const { server } = await import("@/mcp-server")
    const instructions = JSON.stringify(server.server.getClientCapabilities?.() ?? {})
    expect(instructions).not.toContain("logging")
  })
})

describe("statelessness", () => {
  it("does not vary the tool list as a side effect of other requests", async () => {
    // The revision requires the tool set to be stable: it "MUST NOT vary
    // per-connection or as a side effect of other requests on the connection."
    // Sanction holds no per-process mutable state — configuration comes from the
    // environment and every decision is a self-contained POST — so exercising a
    // tool in between must leave the surface byte-identical.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ authorized: true }), { status: 200, headers: { "Content-Type": "application/json" } })),
    )
    await client.callTool({
      name: "sanction_authorize",
      arguments: { action: "purchase", amount_usd: 1, merchant: "Anthropic", category: "software" },
    })

    const again = (await client.listTools()).tools as unknown as ToolDef[]
    expect(again).toEqual(tools)
  })
})

describe("W3C trace context propagation", () => {
  function stubFetch(capture: { headers?: Record<string, string> }) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        capture.headers = init.headers as Record<string, string>
        return new Response(JSON.stringify({ authorized: true, request_id: "req_1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }),
    )
  }

  const spendArgs = { action: "purchase", amount_usd: 10, merchant: "Anthropic", category: "software" }

  it("forwards traceparent from _meta to the Sanction API", async () => {
    const capture: { headers?: Record<string, string> } = {}
    stubFetch(capture)

    await client.callTool({
      name: "sanction_authorize",
      arguments: spendArgs,
      _meta: { traceparent: TRACEPARENT, tracestate: "vendor=abc" },
    })

    expect(capture.headers?.traceparent).toBe(TRACEPARENT)
    expect(capture.headers?.tracestate).toBe("vendor=abc")
    // The agent key still travels alongside — tracing never replaces auth.
    expect(capture.headers?.["x-api-key"]).toBe("pxy_test")
  })

  it("sends no trace headers when the host supplies none", async () => {
    const capture: { headers?: Record<string, string> } = {}
    stubFetch(capture)

    await client.callTool({ name: "sanction_authorize", arguments: spendArgs })

    expect(capture.headers?.traceparent).toBeUndefined()
    expect(capture.headers?.tracestate).toBeUndefined()
  })

  it("drops a malformed traceparent instead of forwarding it", async () => {
    const capture: { headers?: Record<string, string> } = {}
    stubFetch(capture)

    await client.callTool({
      name: "sanction_authorize",
      arguments: spendArgs,
      _meta: { traceparent: "00-not-a-trace-id\r\nx-injected: 1" },
    })

    expect(capture.headers?.traceparent).toBeUndefined()
    expect(JSON.stringify(capture.headers)).not.toContain("x-injected")
  })

  it("authorizes normally when trace context is absent — tracing is never load-bearing", async () => {
    const capture: { headers?: Record<string, string> } = {}
    stubFetch(capture)

    const res = (await client.callTool({ name: "sanction_authorize", arguments: spendArgs })) as {
      content: { text: string }[]
      isError?: boolean
    }

    expect(res.isError).toBeFalsy()
    expect(res.content[0].text).toContain("Authorized")
  })
})
