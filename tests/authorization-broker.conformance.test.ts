import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({ db: {} }))

import { classifyBrokerBody, GRANT_META_KEY } from "../lib/broker"
import { canonicalToolRequest } from "../lib/toolRequest"
import vectors from "./fixtures/authorization/grants-v1.json"

// Classification only: server comes from the configured broker route, not
// agent-controlled params. Route enforcement/forwarding has separate tests.
describe("broker tool binding conformance v1", () => {
  it.each(vectors.bindingVectors)("preserves $id through tools/call classification", vector => {
    for (const [request, expected] of [
      [vector.approved, vector.approvedCanonical],
      [vector.retry, vector.retryCanonical],
    ] as const) {
      const call = classifyBrokerBody({
        jsonrpc: "2.0", id: "conformance", method: "tools/call",
        params: {
          name: request.tool, arguments: request.arguments,
          _meta: { [GRANT_META_KEY]: "synthetic-grant", authorized: true },
        },
      })
      expect(call.kind).toBe("tools_call")
      if (call.kind !== "tools_call") throw new Error("Expected intercepted tool call")
      expect(call.grantId).toBe("synthetic-grant")
      expect(call).not.toHaveProperty("authorized")
      expect(canonicalToolRequest({
        tool: call.tool, server: request.server, arguments: call.args,
      })).toBe(expected)
    }
  })
})
