/** Host-side example: MCP transport and authenticated HTTP polling are injected. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type ToolCall = {
  name: string
  arguments: Record<string, Json>
  _meta?: { "sanction/grant_id": string }
}
export type Outcome =
  | { status: "completed"; result: unknown; retried: boolean }
  | { status: "stopped"; reason: string; result?: unknown }
  | { status: "unknown"; reason: string }

export interface Host {
  callTool: (call: ToolCall, signal: AbortSignal) => Promise<unknown>
  pollAuthorization: (requestId: string, signal: AbortSignal) => Promise<unknown>
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function snapshot(value: unknown): Json {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (Array.isArray(value)) return Object.freeze(value.map(snapshot)) as unknown as Json[]
  if (record(value) && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([k, v]) => [k, snapshot(v)])))
  }
  throw new Error("Tool arguments must contain only JSON values")
}

class Deadline extends Error {}

/** At most two tools/call attempts per invocation. Never restart automatically. */
export async function callWithApproval(
  input: { name: string; arguments: Record<string, Json> },
  host: Host,
  options: { timeoutMs?: number; pollIntervalMs?: number; maxPolls?: number } = {},
): Promise<Outcome> {
  const { timeoutMs = 60_000, pollIntervalMs = 1_000, maxPolls = 60 } = options
  if (![timeoutMs, pollIntervalMs, maxPolls].every(Number.isSafeInteger) ||
      timeoutMs <= 0 || timeoutMs > 2_147_483_647 || pollIntervalMs < 0 || maxPolls <= 0) {
    return { status: "stopped", reason: "invalid_limits" }
  }
  let frozen: ToolCall
  try {
    if (!input.name.trim() || !record(input.arguments)) throw new Error("Invalid call")
    frozen = Object.freeze({ name: input.name, arguments: snapshot(input.arguments) as Record<string, Json> })
  } catch {
    return { status: "stopped", reason: "invalid_call" }
  }
  const deadline = Date.now() + timeoutMs
  async function bounded<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new Deadline()
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        Promise.resolve().then(() => operation(controller.signal)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Deadline()) }, remaining)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
  async function attempt(call: ToolCall): Promise<{ result: unknown } | Outcome> {
    try { return { result: await bounded(signal => host.callTool(call, signal)) } }
    catch { return { status: "unknown", reason: "tool_call_outcome_unknown" } }
  }
  function inspect(result: unknown, retried: boolean): Outcome | { requestId: string } {
    if (!record(result) || !Array.isArray(result.content) ||
        result.content.some(item => !record(item) || typeof item.type !== "string")) {
      return { status: "unknown", reason: "malformed_tool_result" }
    }
    if (result._meta !== undefined && !record(result._meta)) {
      return { status: "stopped", reason: "malformed_decision", result }
    }
    const decision = record(result._meta) ? result._meta["sanction/decision"] : undefined
    if (decision === undefined) return result.isError === true
      ? { status: "stopped", reason: "tool_error", result }
      : { status: "completed", result, retried }
    if (!record(decision) || typeof decision.status !== "string") {
      return { status: "stopped", reason: "malformed_decision", result }
    }
    if (decision.status === "unknown") return { status: "unknown", reason: "broker_outcome_unknown" }
    if (decision.status !== "escalated" || retried) {
      return { status: "stopped", reason: retried ? "retry_terminal" : "terminal_decision", result }
    }
    if (decision.action_type !== "tool.invoke" || result.isError !== true) {
      return { status: "stopped", reason: "unsupported_approval_origin", result }
    }
    if (typeof decision.request_id !== "string" || !decision.request_id.trim()) {
      return { status: "stopped", reason: "missing_request_id", result }
    }
    return { requestId: decision.request_id }
  }
  const first = await attempt(frozen)
  if ("status" in first) return first
  const initial = inspect(first.result, false)
  if ("status" in initial) return initial
  for (let poll = 0; poll < maxPolls; poll++) {
    let state: unknown
    try {
      if (poll > 0) await bounded(signal => new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, Math.min(pollIntervalMs, timeoutMs))
        signal.addEventListener("abort", () => { clearTimeout(timer); reject(new Deadline()) }, { once: true })
      }))
      state = await bounded(signal => host.pollAuthorization(initial.requestId, signal))
    } catch (error) {
      return { status: "stopped", reason: error instanceof Deadline ? "timeout" : "poll_failed" }
    }
    if (!record(state) || state.request_id !== initial.requestId) {
      return { status: "stopped", reason: "malformed_authorization" }
    }
    if (state.status === "escalated") continue
    if (state.status !== "approved") return { status: "stopped", reason: "terminal_authorization" }
    const expires = typeof state.grant_expires_at === "string" ? Date.parse(state.grant_expires_at) : NaN
    if (state.grant_status !== "active" || state.grant_consumed_at !== null ||
        typeof state.grant_id !== "string" || !state.grant_id.trim() ||
        !Number.isFinite(expires) || expires <= Date.now()) {
      return { status: "stopped", reason: "invalid_grant" }
    }
    if (Date.now() >= deadline) return { status: "stopped", reason: "timeout" }
    const retry = await attempt(Object.freeze({ ...frozen, _meta: Object.freeze({ "sanction/grant_id": state.grant_id }) }))
    if ("status" in retry) return retry
    return inspect(retry.result, true) as Outcome
  }
  return { status: "stopped", reason: "poll_limit" }
}
