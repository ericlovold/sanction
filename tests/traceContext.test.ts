import { describe, expect, it } from "vitest"
import { extractTraceContext, traceHeaders, traceId } from "@/lib/traceContext"

// A valid W3C traceparent (the example from the MCP 2026-07-28 `_meta` section).
const VALID = "00-0af7651916cd43dd8448eb211c80319c-00f067aa0ba902b7-01"

describe("extractTraceContext", () => {
  it("keeps a well-formed traceparent", () => {
    expect(extractTraceContext({ traceparent: VALID })).toEqual({ traceparent: VALID })
  })

  it("returns empty for absent or non-object _meta", () => {
    expect(extractTraceContext(undefined)).toEqual({})
    expect(extractTraceContext(null)).toEqual({})
    expect(extractTraceContext("traceparent")).toEqual({})
  })

  it.each([
    ["wrong version", "01-0af7651916cd43dd8448eb211c80319c-00f067aa0ba902b7-01"],
    ["short trace-id", "00-0af7651916cd43dd8448eb211c8031-00f067aa0ba902b7-01"],
    ["uppercase hex", "00-0AF7651916CD43DD8448EB211C80319C-00f067aa0ba902b7-01"],
    ["missing flags", "00-0af7651916cd43dd8448eb211c80319c-00f067aa0ba902b7"],
    ["all-zero trace-id", "00-00000000000000000000000000000000-00f067aa0ba902b7-01"],
    ["all-zero parent-id", "00-0af7651916cd43dd8448eb211c80319c-0000000000000000-01"],
    ["empty", ""],
  ])("drops an invalid traceparent (%s)", (_label, traceparent) => {
    expect(extractTraceContext({ traceparent })).toEqual({})
  })

  it("drops a traceparent carrying CR/LF so it cannot smuggle a header", () => {
    expect(extractTraceContext({ traceparent: `${VALID}\r\nx-injected: 1` })).toEqual({})
    expect(extractTraceContext({ traceparent: `${VALID}\nx-injected: 1` })).toEqual({})
  })

  it("keeps tracestate and baggage alongside a valid traceparent", () => {
    expect(
      extractTraceContext({ traceparent: VALID, tracestate: "vendor=abc123,other=xyz", baggage: "team=platform,env=prod" }),
    ).toEqual({ traceparent: VALID, tracestate: "vendor=abc123,other=xyz", baggage: "team=platform,env=prod" })
  })

  it("drops tracestate and baggage when the traceparent is invalid", () => {
    expect(extractTraceContext({ traceparent: "nope", tracestate: "vendor=abc", baggage: "team=platform" })).toEqual({})
  })

  it("drops a tracestate or baggage carrying CR/LF", () => {
    const injected = "vendor=abc\r\nx-injected: 1"
    expect(extractTraceContext({ traceparent: VALID, tracestate: injected })).toEqual({ traceparent: VALID })
    expect(extractTraceContext({ traceparent: VALID, baggage: injected })).toEqual({ traceparent: VALID })
  })

  it("drops a tracestate over the 32-member limit", () => {
    const tracestate = Array.from({ length: 33 }, (_v, i) => `k${i}=v`).join(",")
    expect(extractTraceContext({ traceparent: VALID, tracestate })).toEqual({ traceparent: VALID })
  })

  it("drops baggage over the size limit", () => {
    const baggage = `k=${"v".repeat(8200)}`
    expect(extractTraceContext({ traceparent: VALID, baggage })).toEqual({ traceparent: VALID })
  })

  it("ignores non-string values", () => {
    expect(extractTraceContext({ traceparent: 42 })).toEqual({})
    expect(extractTraceContext({ traceparent: VALID, tracestate: { a: 1 } })).toEqual({ traceparent: VALID })
  })
})

describe("traceHeaders", () => {
  it("renders only the fields present", () => {
    expect(traceHeaders({})).toEqual({})
    expect(traceHeaders({ traceparent: VALID })).toEqual({ traceparent: VALID })
    expect(traceHeaders({ traceparent: VALID, tracestate: "vendor=abc" })).toEqual({
      traceparent: VALID,
      tracestate: "vendor=abc",
    })
  })
})

describe("traceId", () => {
  it("extracts the 32-hex trace-id", () => {
    expect(traceId({ traceparent: VALID })).toBe("0af7651916cd43dd8448eb211c80319c")
  })

  it("is undefined without a traceparent", () => {
    expect(traceId({})).toBeUndefined()
  })
})
