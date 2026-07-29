// W3C Trace Context propagation (MCP 2026-07-28).
//
// The 2026-07-28 revision deprecates protocol-level Logging and points
// observability at OpenTelemetry instead. It reserves three `_meta` keys —
// `traceparent`, `tracestate`, `baggage` — as an explicit exception to the
// reverse-DNS prefix rule, and requires their values to follow W3C Trace
// Context / W3C Baggage. sanction-mcp reads them off each tool call and
// forwards them to the Sanction API as the same-named HTTP headers, so a
// governed decision can be correlated with the caller's own trace.
//
// Everything here is pure over its input and does no IO, so it replays
// deterministically and unit-tests without a transport (docs/DOMAIN.md
// § Engineering principles).
//
// SECURITY: these values arrive from the MCP host — untrusted input that we
// turn into outbound HTTP headers. Every field is validated against its W3C
// grammar and dropped on any mismatch. The grammars exclude CR, LF, and NUL,
// so a malformed value can never smuggle a second header into the request.

export type TraceContext = {
  traceparent?: string
  tracestate?: string
  baggage?: string
}

// W3C Trace Context §3.2.2: version "00", 32-hex trace-id, 16-hex parent-id,
// 2-hex trace-flags, lowercase, dash-separated. Future versions are permitted
// to append fields, but we only forward what we can fully validate.
const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/

// W3C Trace Context §3.3.1: up to 32 comma-separated `key=value` members.
// Members are printable ASCII excluding comma and equals inside the parts.
const TRACESTATE_MEMBER = /^[ \t]*[!-+\--<>-~]+=[ \t]*[!-+\--:<-~]*[ \t]*$/
const TRACESTATE_MAX_MEMBERS = 32

// W3C Baggage §3.2: comma-separated `key=value` list, printable ASCII only.
// The spec's recommended limits are 64 members and 8192 bytes total.
const BAGGAGE_MEMBER = /^[ \t]*[\x21-\x2b\x2d-\x3c\x3e-\x7e]+=[\x21-\x2b\x2d-\x3a\x3c-\x7e]*[ \t]*$/
const BAGGAGE_MAX_MEMBERS = 64
const BAGGAGE_MAX_BYTES = 8192

function validTraceparent(value: string): boolean {
  const m = TRACEPARENT.exec(value)
  if (!m) return false
  // An all-zero trace-id or parent-id is explicitly invalid (§3.2.2.3/§3.2.2.4).
  return !/^0+$/.test(m[1]) && !/^0+$/.test(m[2])
}

function validList(value: string, member: RegExp, maxMembers: number): boolean {
  if (value.length === 0) return false
  const members = value.split(",")
  if (members.length > maxMembers) return false
  return members.every((m) => member.test(m))
}

/**
 * Pull W3C trace context out of an MCP request's `_meta`, keeping only the
 * fields that validate. An invalid field is dropped rather than failing the
 * call: tracing is diagnostic, and a malformed header must never be the reason
 * a spend authorization does not happen.
 */
export function extractTraceContext(meta: unknown): TraceContext {
  if (!meta || typeof meta !== "object") return {}
  const m = meta as Record<string, unknown>
  const ctx: TraceContext = {}

  const traceparent = m.traceparent
  if (typeof traceparent === "string" && validTraceparent(traceparent)) {
    ctx.traceparent = traceparent
  }

  // tracestate and baggage only travel with a valid traceparent — on their own
  // they correlate nothing, and forwarding them would leak host state for free.
  if (!ctx.traceparent) return ctx

  const tracestate = m.tracestate
  if (typeof tracestate === "string" && validList(tracestate, TRACESTATE_MEMBER, TRACESTATE_MAX_MEMBERS)) {
    ctx.tracestate = tracestate
  }

  const baggage = m.baggage
  if (
    typeof baggage === "string" &&
    Buffer.byteLength(baggage, "utf8") <= BAGGAGE_MAX_BYTES &&
    validList(baggage, BAGGAGE_MEMBER, BAGGAGE_MAX_MEMBERS)
  ) {
    ctx.baggage = baggage
  }

  return ctx
}

/** Render a validated trace context as outbound HTTP headers. */
export function traceHeaders(ctx: TraceContext): Record<string, string> {
  const headers: Record<string, string> = {}
  if (ctx.traceparent) headers["traceparent"] = ctx.traceparent
  if (ctx.tracestate) headers["tracestate"] = ctx.tracestate
  if (ctx.baggage) headers["baggage"] = ctx.baggage
  return headers
}

/** The 32-hex trace-id, for correlating a decision with the caller's trace. */
export function traceId(ctx: TraceContext): string | undefined {
  if (!ctx.traceparent) return undefined
  return TRACEPARENT.exec(ctx.traceparent)?.[1]
}
