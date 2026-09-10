import { describe, it, expect } from "vitest"
import {
  LIST_FILTER_META_KEY,
  buildFilteredListResponse,
  failClosedEmptyList,
  filterToolsList,
  isVisibleOnList,
  listFilterDetails,
  listFilterNote,
  parseToolsListResult,
  parseUpstreamJsonRpc,
  type ListFilterActor,
  type ListFilterVerdict,
} from "../lib/brokerListFilter"

const WHO: ListFilterActor = { agent_id: "agent_1", agent: "tenet", wallet_id: "wallet_1" }
const WHEN = "2026-09-09T23:59:00.000Z"

const decide =
  (map: Record<string, ListFilterVerdict>): ((tool: string) => ListFilterVerdict) =>
  (tool) =>
    map[tool] ?? { effect: "deny", code: "TOOL_NOT_ALLOWED", reason: `Tool '${tool}' is not in the allow-list` }

describe("filterToolsList — fail-closed allow-list", () => {
  it("lists only allow-list tools and withholds the rest with who/what/why/when", () => {
    const filtered = filterToolsList(
      [
        { name: "repo.read", description: "read" },
        { name: "payments.charge", description: "charge" },
        { name: "deploy.production", description: "deploy" },
      ],
      {
        who: WHO,
        upstream: "github",
        when: WHEN,
        decide: decide({
          "repo.read": { effect: "allow", reason: "Tool 'repo.read' is permitted" },
          "payments.charge": { effect: "deny", code: "TOOL_BLOCKED", reason: "Tool 'payments.charge' is blocked" },
          "deploy.production": { effect: "escalate", code: "TOOL_ESCALATION_REQUIRED", reason: "needs a human" },
        }),
      },
    )

    expect(filtered.listed).toEqual(["repo.read", "deploy.production"])
    expect(filtered.withheld).toEqual(["payments.charge"])
    expect(filtered.tools.map((t) => t.name)).toEqual(["repo.read", "deploy.production"])

    const deny = filtered.receipts.find((r) => r.what.tool === "payments.charge")
    expect(deny).toMatchObject({
      who: WHO,
      what: { surface: "mcp.broker.tools/list", upstream: "github", tool: "payments.charge" },
      why: { effect: "deny", code: "TOOL_BLOCKED", visible: false },
      when: WHEN,
    })
    expect(deny?.why.reason).toContain("blocked")

    const allow = filtered.receipts.find((r) => r.what.tool === "repo.read")
    expect(allow?.why).toMatchObject({ effect: "allow", visible: true })
    expect(allow?.who.agent_id).toBe("agent_1")
  })

  it("an unnamed upstream entry is withheld fail-closed", () => {
    const filtered = filterToolsList([{ description: "no name" }], {
      who: WHO,
      upstream: "github",
      when: WHEN,
      decide: () => ({ effect: "allow" }),
    })
    expect(filtered.tools).toEqual([])
    expect(filtered.withheld).toEqual(["(unnamed)"])
    expect(filtered.receipts[0].why.code).toBe("TOOL_LIST_UNNAMED")
  })

  it("observe mode lists a denied tool and records the would-be deny", () => {
    const filtered = filterToolsList([{ name: "payments.charge" }], {
      who: WHO,
      upstream: "github",
      when: WHEN,
      observe: true,
      decide: () => ({ effect: "deny", code: "TOOL_NOT_ALLOWED", reason: "not listed" }),
    })
    expect(filtered.listed).toEqual(["payments.charge"])
    expect(filtered.withheld).toEqual([])
    expect(filtered.receipts[0].why.visible).toBe(true)
    expect(filtered.receipts[0].why.observed).toBe(true)
    expect(filtered.receipts[0].why.would_be).toEqual({
      effect: "deny",
      code: "TOOL_NOT_ALLOWED",
      reason: "not listed",
    })
  })
})

describe("isVisibleOnList", () => {
  it("denies are hidden; allow and escalate stay visible; observe shows all", () => {
    expect(isVisibleOnList("deny", false)).toBe(false)
    expect(isVisibleOnList("allow", false)).toBe(true)
    expect(isVisibleOnList("escalate", false)).toBe(true)
    expect(isVisibleOnList("deny", true)).toBe(true)
  })
})

describe("parseUpstreamJsonRpc / parseToolsListResult", () => {
  const list = { jsonrpc: "2.0", id: 1, result: { tools: [{ name: "a" }], nextCursor: "n" } }

  it("parses a JSON tools/list result and preserves rest fields", () => {
    const rpc = parseUpstreamJsonRpc(JSON.stringify(list), "application/json")
    const parsed = parseToolsListResult(rpc)
    expect(parsed?.tools).toEqual([{ name: "a" }])
    expect(parsed?.rest.nextCursor).toBe("n")
  })

  it("parses a single-event SSE tools/list", () => {
    const sse = `event: message\ndata: ${JSON.stringify(list)}\n\n`
    const parsed = parseToolsListResult(parseUpstreamJsonRpc(sse, "text/event-stream"))
    expect(parsed?.tools).toHaveLength(1)
  })

  it("unparseable bodies fail closed (null — the shell withholds)", () => {
    expect(parseUpstreamJsonRpc("not-json", "application/json")).toBeNull()
    expect(parseToolsListResult({ jsonrpc: "2.0", id: 1, result: { content: [] } })).toBeNull()
    expect(parseToolsListResult({ jsonrpc: "2.0", result: "nope" })).toBeNull()
  })
})

describe("receipt envelope — the readable slip", () => {
  it("fail-closed empty list names the list itself", () => {
    const empty = failClosedEmptyList({
      who: WHO,
      upstream: "github",
      when: WHEN,
      id: 9,
      code: "NO_POLICY",
      reason: "No policy configured",
    })
    expect(empty.result.tools).toEqual([])
    expect(empty.receipts[0]).toMatchObject({
      who: WHO,
      what: { tool: "*", upstream: "github" },
      why: { effect: "deny", code: "NO_POLICY", visible: false },
      when: WHEN,
    })
    expect(empty.body.result).toMatchObject({ tools: [] })
  })

  it("filtered response _meta carries the receipts the host can read", () => {
    const filtered = filterToolsList([{ name: "repo.read" }, { name: "shell.exec" }], {
      who: WHO,
      upstream: "github",
      when: WHEN,
      decide: decide({ "repo.read": { effect: "allow", reason: "permitted" } }),
    })
    const body = buildFilteredListResponse(1, { nextCursor: null }, filtered, "req_list") as {
      result: { tools: { name: string }[]; _meta: Record<string, { withheld: number; receipts: unknown[]; request_id: string }> }
    }
    expect(body.result.tools.map((t) => t.name)).toEqual(["repo.read"])
    const meta = body.result._meta[LIST_FILTER_META_KEY]
    expect(meta.request_id).toBe("req_list")
    expect(meta.withheld).toBe(1)
    expect(meta.receipts).toHaveLength(2)

    const details = listFilterDetails({ upstream: "github", filtered })
    expect(details.listed).toEqual(["repo.read"])
    expect(details.withheld).toEqual(["shell.exec"])
    expect(listFilterNote(filtered)).toContain("withheld 1")
  })
})
