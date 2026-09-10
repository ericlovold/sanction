// BROKER-2 (spike): fail-closed tools/list filtering on the MCP broker.
//
// tools/call is already intercepted (BROKER-1). This slice is the Trust/
// Recommend boundary: the host's tool picker never sees a tool the policy
// would refuse, and every list-time allow/deny leaves a who / what / why /
// when receipt. Call-time allows stay decision-only; list-time writes both
// effects because the withheld set is the evidence that filtering ran.
//
// Visibility uses the SAME layered tool ladder as /authorize/tool
// (decideToolLayered). This module is the pure fold: given tools + a decide
// function, return the listed set and the receipts. Persistence and policy
// IO live in the broker route (the enforcement shell).
//
// Empty allow-list stays opt-in (allow all except blocked) — that is the
// existing tool-ladder contract, not a new one. Fail-closed means: unlisted
// when an allow-list is set, blocked, unnamed, or unparseable → withhold.

export const LIST_FILTER_META_KEY = "sanction/list_filter"
export const LIST_ACTION = "list"

export type ListFilterVerdict = {
  effect: "allow" | "deny" | "escalate"
  code?: string
  reason?: string
}

export type ListFilterActor = {
  agent_id: string
  agent: string
  wallet_id: string
}

export type ListFilterReceipt = {
  who: ListFilterActor
  what: { surface: "mcp.broker.tools/list"; upstream: string; tool: string }
  why: {
    effect: "allow" | "deny" | "escalate"
    code?: string
    reason: string
    visible: boolean
    observed?: boolean
    would_be?: { effect: "deny" | "escalate"; code?: string; reason?: string }
  }
  when: string
}

export type ListFilterResult = {
  tools: Record<string, unknown>[]
  receipts: ListFilterReceipt[]
  listed: string[]
  withheld: string[]
}

/** A tool is shown unless the ladder denies it. Observe mode shows everything
 * (call-time observe never blocks) and records the would-be effect. */
export function isVisibleOnList(effect: ListFilterVerdict["effect"], observe: boolean): boolean {
  return observe || effect !== "deny"
}

export function filterToolsList(
  tools: unknown[],
  input: {
    who: ListFilterActor
    upstream: string
    when: string
    observe?: boolean
    decide: (tool: string) => ListFilterVerdict
  },
): ListFilterResult {
  const observe = input.observe === true
  const listed: string[] = []
  const withheld: string[] = []
  const kept: Record<string, unknown>[] = []
  const receipts: ListFilterReceipt[] = []

  for (const raw of tools) {
    const tool = toolName(raw)
    if (tool === null) {
      const receipt = receiptOf(input, "(unnamed)", {
        effect: "deny",
        code: "TOOL_LIST_UNNAMED",
        reason: "Upstream tool entry had no name; withheld fail-closed",
        visible: false,
      })
      receipts.push(receipt)
      withheld.push("(unnamed)")
      continue
    }
    const verdict = input.decide(tool)
    const visible = isVisibleOnList(verdict.effect, observe)
    const why: ListFilterReceipt["why"] = {
      effect: observe && verdict.effect !== "allow" ? "allow" : verdict.effect,
      code: observe && verdict.effect !== "allow" ? undefined : verdict.code,
      reason: observe && verdict.effect !== "allow"
        ? `Observe mode — would ${verdict.effect}: ${verdict.reason ?? verdict.effect}`
        : (verdict.reason ?? (verdict.effect === "allow" ? `Tool '${tool}' is permitted` : `Tool '${tool}' is not permitted`)),
      visible,
    }
    if (observe && verdict.effect !== "allow") {
      why.observed = true
      why.would_be = { effect: verdict.effect, code: verdict.code, reason: verdict.reason }
    }
    receipts.push(receiptOf(input, tool, why))
    if (visible) {
      listed.push(tool)
      if (raw && typeof raw === "object" && !Array.isArray(raw)) kept.push(raw as Record<string, unknown>)
    } else {
      withheld.push(tool)
    }
  }

  return { tools: kept, receipts, listed, withheld }
}

function receiptOf(
  input: { who: ListFilterActor; upstream: string; when: string },
  tool: string,
  why: ListFilterReceipt["why"],
): ListFilterReceipt {
  return {
    who: input.who,
    what: { surface: "mcp.broker.tools/list", upstream: input.upstream, tool },
    why,
    when: input.when,
  }
}

function toolName(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const name = (raw as { name?: unknown }).name
  return typeof name === "string" && name.length > 0 ? name : null
}

/** Whole-list refusal (frozen, no policy, unparseable upstream). Empty tools,
 * one receipt naming the list itself. */
export function failClosedEmptyList(input: {
  who: ListFilterActor
  upstream: string
  when: string
  id: string | number | null
  code: string
  reason: string
}): { body: Record<string, unknown>; receipts: ListFilterReceipt[]; result: ListFilterResult } {
  const receipts = [
    receiptOf(input, "*", { effect: "deny", code: input.code, reason: input.reason, visible: false }),
  ]
  const result: ListFilterResult = { tools: [], receipts, listed: [], withheld: ["*"] }
  return {
    body: buildFilteredListResponse(input.id, {}, result),
    receipts,
    result,
  }
}

export function parseUpstreamJsonRpc(raw: string, contentType: string | null): unknown | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const ct = (contentType ?? "").toLowerCase()
  const looksSse = ct.includes("text/event-stream") || trimmed.startsWith("event:") || trimmed.startsWith("data:")
  if (looksSse) {
    const data = trimmed
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim()
    if (!data || data === "[DONE]") return null
    try {
      return JSON.parse(data) as unknown
    } catch {
      return null
    }
  }
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return null
  }
}

export function parseToolsListResult(body: unknown): { id: string | number | null; tools: unknown[]; rest: Record<string, unknown> } | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null
  const msg = body as Record<string, unknown>
  if (msg.jsonrpc !== "2.0") return null
  if (!msg.result || typeof msg.result !== "object" || Array.isArray(msg.result)) return null
  const result = msg.result as Record<string, unknown>
  if (!Array.isArray(result.tools)) return null
  const id = msg.id
  const rpcId = typeof id === "string" || typeof id === "number" ? id : null
  return { id: rpcId, tools: result.tools, rest: result }
}

export function buildFilteredListResponse(
  id: string | number | null,
  resultRest: Record<string, unknown>,
  filtered: ListFilterResult,
  requestId?: string,
): Record<string, unknown> {
  const existingMeta =
    resultRest._meta && typeof resultRest._meta === "object" && !Array.isArray(resultRest._meta)
      ? (resultRest._meta as Record<string, unknown>)
      : {}
  return {
    jsonrpc: "2.0",
    id,
    result: {
      ...resultRest,
      tools: filtered.tools,
      _meta: {
        ...existingMeta,
        [LIST_FILTER_META_KEY]: {
          request_id: requestId,
          who: filtered.receipts[0]?.who,
          when: filtered.receipts[0]?.when,
          listed: filtered.listed.length,
          withheld: filtered.withheld.length,
          receipts: filtered.receipts,
        },
      },
    },
  }
}

/** Persistable detailsJson for the list-time AuthorizationRequest. */
export function listFilterDetails(input: {
  upstream: string
  observe?: boolean
  filtered: ListFilterResult
}): {
  surface: "mcp.broker.tools/list"
  upstream: string
  listed: string[]
  withheld: string[]
  receipts: ListFilterReceipt[]
  observed?: boolean
} {
  return {
    surface: "mcp.broker.tools/list",
    upstream: input.upstream,
    listed: input.filtered.listed,
    withheld: input.filtered.withheld,
    receipts: input.filtered.receipts,
    ...(input.observe ? { observed: true } : {}),
  }
}

export function listFilterNote(filtered: ListFilterResult): string {
  if (filtered.withheld.length === 0) {
    return `tools/list allowed ${filtered.listed.length} tool(s)`
  }
  return `tools/list withheld ${filtered.withheld.length} tool(s) not permitted by policy`
}
