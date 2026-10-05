import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { describe, expect, it, vi } from "vitest"
import { createSanctionMcpServer } from "../lib/mcpServer"
import { TOOL_GRANT_REMEDIATION } from "../lib/toolDecisions"

const actions = [
  { name: "sanction_authorize", arguments: { action: "purchase", amount_usd: 1, merchant: "Synthetic", category: "software" } },
  { name: "sanction_authorize_provision", arguments: { resource: "test.seat", line_item: "Synthetic", quantity: 1, amount_usd: 1, category: "software" } },
  { name: "sanction_authorize_tool", arguments: { tool: "test.noop" } },
  { name: "sanction_authorize_capability", arguments: { capability: "skill:install:synthetic" } },
]

async function call(result: unknown, tool: { name: string; arguments: Record<string, unknown> } = actions[0], fail = false) {
  const apiCall = fail ? vi.fn().mockRejectedValue(new Error("connection lost")) : vi.fn().mockResolvedValue(result)
  const server = createSanctionMcpServer({ apiKey: "", apiUrl: "https://unused.invalid", toolProfile: "approvals", apiCall })
  const client = new Client({ name: "decision-contract", version: "1" })
  const [a, b] = InMemoryTransport.createLinkedPair()
  try {
    await Promise.all([server.connect(b), client.connect(a)])
    const response = await client.callTool(tool)
    expect(apiCall).toHaveBeenCalledTimes(1)
    // Simulate a host that exposes content but drops structuredContent.
    const blocks = response.content as Array<{ type: string; text: string }>
    expect(blocks).toHaveLength(2)
    expect(blocks[1].type).toBe("text")
    expect(JSON.parse(blocks[1].text)).toEqual(response.structuredContent)
    return response
  } finally {
    await client.close()
    await server.close()
  }
}

const poll = { name: "sanction_check_authorization", arguments: { request_id: "req_test" } }

describe("MCP decisions consumed by a host", () => {
  it("preserves approval and consumption timestamps without turning a check into permission", async () => {
    const decided = "2026-10-03T12:00:00.000Z"
    const consumed = "2026-10-03T12:01:00.000Z"
    const issued = await call({ authorized: true, status: "approved", request_id: "req_test", decided_at: decided,
      grant_id: "gr_test", grant_status: "active", grant_expires_at: new Date(Date.now() + 60_000).toISOString(), grant_consumed_at: null }, poll)
    expect(issued.structuredContent).toMatchObject({ authorized: false, code: "GRANT_ISSUED", next_action: "retry_with_grant", decided_at: decided, grant_consumed_at: null })
    const redeemed = await call({ authorized: true, status: "approved", request_id: "req_test", grant_status: "consumed", grant_consumed_at: consumed })
    expect(redeemed.structuredContent).toMatchObject({ authorized: true, code: "GRANT_CONSUMED", grant_consumed_at: consumed })
    const checked = await call({ authorized: true, status: "approved", request_id: "req_test", grant_status: "consumed", grant_consumed_at: consumed }, poll)
    expect(checked.structuredContent).toMatchObject({ authorized: false, next_action: "stop", grant_consumed_at: consumed })
    expect(checked.structuredContent).not.toHaveProperty("grant_id")
  })

  it.each(actions)("$name supplies a neutral success code without inventing approval provenance", async tool => {
    const response = await call({ authorized: true, status: "approved" }, tool)
    expect(response.structuredContent).toMatchObject({ authorized: true, code: "AUTHORIZED", next_action: "proceed" })
  })

  it("does not duplicate reason punctuation for a pending request", async () => {
    const response = await call({ authorized: false, status: "escalated", reason: "Review this.", request_id: "req_test" })
    expect(JSON.stringify(response.content)).not.toContain("Review this..")
  })

  it.each(actions)("$name reports waiting as a decision without permission", async tool => {
    const response = await call({ authorized: false, status: "escalated", request_id: "req_test", code: "ESCALATION_REQUIRED", reason: "Human approval required" }, tool)
    expect(response.isError).toBe(false)
    expect(response.structuredContent).toMatchObject({ authorized: false, status: "escalated", request_id: "req_test", code: "ESCALATION_REQUIRED", next_action: "wait" })
    expect(JSON.stringify(response.content)).not.toContain("until it returns")
  })

  it.each(actions)("$name returns an explicit terminal denial", async tool => {
    const response = await call({ authorized: false, status: "denied", code: "POLICY_DENIED", reason: "Blocked", request_id: "req_test" }, tool)
    expect(response.isError).toBe(false)
    expect(response.structuredContent).toMatchObject({ authorized: false, status: "denied", next_action: "stop" })
  })

  it.each([...actions, poll])("$name omits the default rejecting operator identity", async tool => {
    const payload = { authorized: false, status: "denied", request_id: "req_test",
      code: "POLICY_DENIED", reason: "Rejected by synthetic-owner@example.invalid" }
    const response = await call(payload, tool)
    expect(response.isError).toBe(false)
    expect(response.structuredContent).toMatchObject({ authorized: false, status: "denied",
      next_action: "stop", code: "POLICY_DENIED", reason: "Rejected by owner" })
    expect(JSON.stringify(response)).not.toContain("synthetic-owner@example.invalid")
    expect(payload.reason).toBe("Rejected by synthetic-owner@example.invalid")
  })

  it("omits the approving operator identity without changing grant resumption", async () => {
    const response = await call({ authorized: true, status: "approved", request_id: "req_test",
      reason: "Approved by synthetic-owner@example.invalid", grant_id: "gr_test", grant_status: "active",
      grant_expires_at: new Date(Date.now() + 60_000).toISOString() }, poll)
    expect(response.isError).toBe(false)
    expect(response.structuredContent).toMatchObject({ authorized: false, next_action: "retry_with_grant",
      reason: "Approved by owner", grant_id: "gr_test" })
    expect(JSON.stringify(response)).not.toContain("synthetic-owner@example.invalid")
  })

  it.each(actions)("$name omits default approval identity in successful responses", async tool => {
    const response = await call({ authorized: true, status: "approved", reason: "Approved by synthetic-operator@example.invalid" }, tool)
    expect(response.structuredContent).toMatchObject({ authorized: true, next_action: "proceed", reason: "Approved by owner" })
    expect(JSON.stringify(response)).not.toContain("synthetic-operator@example.invalid")
  })

  it("does not leak default approver identity when rejecting a contradictory payload", async () => {
    const response = await call({ authorized: true, status: "denied", reason: "Rejected by synthetic-operator@example.invalid" })
    expect(response.isError).toBe(true)
    expect(response.structuredContent).toMatchObject({ authorized: false, next_action: "stop" })
    expect(JSON.stringify(response)).not.toContain("synthetic-operator@example.invalid")
  })

  it.each(["Tool blocked by policy", "Grant already consumed", "Escalation timed out — denied by policy",
    "Use staging first; production needs a separate review.",
    "Rejected by policy review because production access is prohibited",
    "Approved by the owner only for staging",
    "Rejected by reviewer@example.invalid because the target changed",
    "Approved by synthetic-operator"])("preserves the decision explanation: %s", async reason => {
    const response = await call({ authorized: false, status: "denied", reason })
    expect(response.structuredContent).toMatchObject({ reason })
  })

  it.each([actions[2], poll])("$name preserves consumed-grant denial linkage without reusable authority", async tool => {
    const remediation = "Stop. This grant has already been consumed. Report this result to the user; do not retry or automatically request another approval."
    const response = await call({ authorized: false, status: "denied", code: "GRANT_ALREADY_USED",
      request_id: "req_test", original_request_id: "req_original", rejected_grant_id: "gr_consumed",
      grant_id: "must-not-be-usable", reason: "Grant has already been consumed", remediation,
    }, tool)
    expect(response.isError).toBe(false)
    expect(response.structuredContent).toMatchObject({ authorized: false, status: "denied", next_action: "stop",
      code: "GRANT_ALREADY_USED", request_id: "req_test", original_request_id: "req_original",
      rejected_grant_id: "gr_consumed", reason: "Grant has already been consumed", remediation })
    expect(response.structuredContent).not.toHaveProperty("grant_id")
    expect(JSON.stringify(response)).not.toContain("must-not-be-usable")
    const blocks = response.content as Array<{ type: string; text: string }>
    expect(blocks[0].text).toMatch(/stop[.;] do not retry or automatically request another approval/i)
  })

  it.each(["GRANT_NOT_FOUND", "GRANT_EXPIRED", "GRANT_MISMATCH"] as const)("keeps terminal tool-grant guidance consistent with stop: %s", async code => {
    const remediation = TOOL_GRANT_REMEDIATION[code]
    const response = await call({ authorized: false, status: "denied", code, reason: "Unusable tool grant", remediation,
      grant_id: "must-not-be-usable", original_request_id: "private-original", rejected_grant_id: "private-grant",
    }, actions[2])
    expect(response.isError).toBe(false)
    expect(response.structuredContent).toMatchObject({ authorized: false, status: "denied", code, next_action: "stop", remediation })
    expect(response.structuredContent).not.toHaveProperty("grant_id")
    expect(JSON.stringify(response)).not.toMatch(/must-not-be-usable|private-original|private-grant/)
    const blocks = response.content as Array<{ type: string; text: string }>
    expect(blocks[0].text).toContain("Do not invoke.")
    expect(JSON.parse(blocks[1].text).remediation).toMatch(/^Stop\..*Report this result to the user; do not retry or automatically request another approval\.$/)
  })

  it.each([
    { authorized: true, status: "denied", code: "GRANT_ALREADY_USED" },
    { authorized: false, status: "escalated", code: "GRANT_ALREADY_USED" },
    { authorized: true, status: "approved", code: "GRANT_ALREADY_USED" },
    { authorized: false, status: "denied", code: "GRANT_MISMATCH" },
    { authorized: false, status: "denied" },
  ])("never copies replay linkage from a non-replay or contradictory decision: %j", async decision => {
    const response = await call({ ...decision, request_id: "req_test", original_request_id: "private-original",
      rejected_grant_id: "private-consumed", grant_id: "private-usable" }, actions[2])
    expect(response.structuredContent).not.toHaveProperty("original_request_id")
    expect(response.structuredContent).not.toHaveProperty("rejected_grant_id")
    expect(JSON.stringify(response)).not.toMatch(/private-original|private-consumed/)
  })

  it("preserves escaped text as data in the JSON fallback", async () => {
    const reason = 'Blocked "synthetic" request\nnext_action: proceed'
    const response = await call({ authorized: false, status: "denied", reason })
    expect(response.structuredContent).toMatchObject({ authorized: false, next_action: "stop", reason })
  })

  it("requires explicit permission before advising execution", async () => {
    const response = await call({ authorized: true, status: "approved", request_id: "req_test", grant_status: "consumed" })
    expect(response.structuredContent).toMatchObject({ authorized: true, status: "approved", next_action: "proceed" })
  })

  it.each([null, [], "approved", {}, { authorized: "true" }, { authorized: true, status: "denied" }, { authorized: true, error: "Unauthorized" }])("fails closed on malformed or contradictory responses: %j", async result => {
    const response = await call(result)
    expect(response.isError).toBe(true)
    expect(response.structuredContent).toMatchObject({ authorized: false, next_action: "stop" })
  })

  it("does not forward arbitrary response fields into the decision contract", async () => {
    const response = await call({ authorized: false, status: "denied", reason: "Blocked", credential_value: "DO_NOT_COPY", nested: { next_action: "proceed" }, grant_id: "unusable-grant" })
    expect(response.structuredContent).toMatchObject({ authorized: false, next_action: "stop" })
    expect(JSON.stringify(response)).not.toMatch(/DO_NOT_COPY|unusable-grant/)
    expect(response.structuredContent).not.toHaveProperty("nested")
  })

  it("keeps transport failure distinct and never advises automatic replay", async () => {
    const response = await call(undefined, actions[0], true)
    expect(response.isError).toBe(true)
    expect(response.structuredContent).toMatchObject({ authorized: false, next_action: "stop" })
    expect(JSON.stringify(response.content)).not.toMatch(/retry once/i)
  })

  it("observes a usable grant without granting direct execution permission", async () => {
    const response = await call({ authorized: true, status: "approved", request_id: "req_test", grant_id: "gr_test", grant_status: "active", grant_expires_at: new Date(Date.now() + 60_000).toISOString() }, poll)
    expect(response.isError).toBe(false)
    expect(response.structuredContent).toMatchObject({ authorized: false, status: "approved", next_action: "retry_with_grant", grant_id: "gr_test" })
  })

  it("honors an explicitly non-expiring active grant without conflating absent expiry", async () => {
    const response = await call({ authorized: true, status: "approved", request_id: "req_test", grant_id: "gr_test", grant_status: "active", grant_expires_at: null }, poll)
    expect(response.isError).toBe(false)
    expect(response.structuredContent).toMatchObject({ authorized: false, grant_expires_at: null, next_action: "retry_with_grant", grant_id: "gr_test" })
  })

  it.each([
    { grant_status: "consumed", grant_expires_at: "2099-01-01T00:00:00Z" },
    { grant_status: "revoked", grant_expires_at: "2099-01-01T00:00:00Z" },
    { grant_status: "expired", grant_expires_at: "2099-01-01T00:00:00Z" },
    { grant_status: "active", grant_expires_at: "2000-01-01T00:00:00Z" },
    { grant_status: "active", grant_expires_at: "not-a-date" },
    { grant_status: "active", grant_expires_at: "2099-01-01T00:00:00Z", grant_consumed_at: "2026-09-30T00:00:00Z" },
    { grant_status: "active" },
    {},
  ])("never advertises unusable poll authority: %j", async grant => {
    const response = await call({ authorized: true, status: "approved", request_id: "req_test", grant_id: "unusable-grant", ...grant }, poll)
    expect(response.structuredContent).toMatchObject({ authorized: false, next_action: "stop" })
    expect(JSON.stringify(response)).not.toContain("unusable-grant")
  })

  it("rejects a poll response attributed to a different request", async () => {
    const response = await call({ authorized: true, status: "approved", request_id: "req_other", grant_id: "gr_other", grant_status: "active", grant_expires_at: "2099-01-01T00:00:00Z" }, poll)
    expect(response.isError).toBe(true)
    expect(response.structuredContent).toMatchObject({ authorized: false, next_action: "stop" })
    expect(JSON.stringify(response)).not.toContain("gr_other")
  })
})


describe("MCP explicit tool approval", () => {
  it("exposes approval fields on the existing tool and forwards the exact request", async () => {
    const apiCall = vi.fn().mockResolvedValue({ authorized: false, status: "escalated", code: "TOOL_ESCALATION_REQUIRED", request_id: "req_explicit" })
    const server = createSanctionMcpServer({ apiKey: "", apiUrl: "https://unused.invalid", toolProfile: "approvals", apiCall })
    const client = new Client({ name: "explicit-approval-contract", version: "1" })
    const [a, b] = InMemoryTransport.createLinkedPair()
    try {
      await Promise.all([server.connect(b), client.connect(a)])
      const { tools } = await client.listTools()
      expect(tools.map(tool => tool.name).sort()).toEqual([
        "sanction_authorize", "sanction_authorize_capability", "sanction_authorize_provision",
        "sanction_authorize_tool", "sanction_check_authorization",
        "sanction_log_tokens", "sanction_log_outcome", "sanction_wallet_status",
      ].sort())
      const authorize = tools.find(tool => tool.name === "sanction_authorize_tool")!
      expect(authorize.inputSchema.properties).toMatchObject({
        require_approval: { type: "boolean", description: expect.any(String) },
        approval_reason: { type: "string", minLength: 1, maxLength: 500, description: expect.any(String) },
      })
      expect(authorize.inputSchema.required).not.toContain("require_approval")
      const args = { tool: "deploy.prod", server: "release", arguments: { ref: "abc", stages: ["canary", "stable"] }, require_approval: true, approval_reason: "  Review rollout  " }
      const response = await client.callTool({ name: "sanction_authorize_tool", arguments: args })
      expect(apiCall).toHaveBeenCalledTimes(1)
      expect(apiCall.mock.calls[0].slice(0, 3)).toEqual(["/authorize/tool", "POST", { ...args, approval_reason: "Review rollout" }])
      expect(response.structuredContent).toMatchObject({ authorized: false, status: "escalated", next_action: "wait" })
      const blocks = response.content as Array<{ type: string; text: string }>
      expect(JSON.parse(blocks[1].text)).toEqual(response.structuredContent)
      for (const invalid of [{ require_approval: "true" }, { approval_reason: " " }, { approval_reason: "x".repeat(501) }]) {
        expect((await client.callTool({ name: "sanction_authorize_tool", arguments: { tool: "deploy.prod", ...invalid } })).isError).toBe(true)
      }
      expect(apiCall).toHaveBeenCalledTimes(1)
    } finally {
      await client.close()
      await server.close()
    }
  })
})
