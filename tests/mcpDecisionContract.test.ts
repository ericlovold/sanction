import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { describe, expect, it, vi } from "vitest"
import { createSanctionMcpServer } from "../lib/mcpServer"

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
