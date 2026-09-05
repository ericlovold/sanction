import { describe, it, expect, vi } from "vitest"
import { db } from "../lib/db"
import { sealToolRequest } from "../lib/toolRequest"
import { consumeToolGrant } from "../lib/grants"
vi.mock("next/server", async (orig) => ({ ...await orig<typeof import("next/server")>(), after: () => {} }))

describe.skipIf(process.env.RUN_DB_TESTS !== "1")("tool grant concurrency", () => {
  it("permits exactly one concurrent redemption of the reviewed request", async () => {
    const wallet = await db.wallet.create({ data: { name: "binding-test", ownerEmail: `binding-${Date.now()}@example.com`, agents: { create: { name: "agent", apiKeyHash: `binding-${Date.now()}`, apiKeyPrefix: "pxy_test" } } }, include: { agents: true } })
    const agentId = wallet.agents[0].id
    try {
      const request = { tool: "deploy", server: "release", arguments: { target: "staging", ref: "abc" } }
      const row = await db.authorizationRequest.create({ data: { agentId, kind: "tool", action: "invoke", amountUsd: 0, merchant: "deploy", category: "tool", status: "escalated" } })
      const grant = await db.grant.create({ data: { walletId: wallet.id, agentId, actionType: "tool.invoke", subjectJson: {}, resourceJson: { requestBinding: await sealToolRequest(wallet.id, request) }, sourceType: "authorization_request", sourceId: row.id } })
      const attempt = () => db.$transaction(tx => consumeToolGrant(tx, { grantId: grant.id, walletId: wallet.id, agentId, request }))
      const results = await Promise.all(Array.from({ length: 8 }, attempt))
      expect(results.filter(r => r.ok)).toHaveLength(1)
      expect(results.filter(r => !r.ok && r.code === "GRANT_ALREADY_USED")).toHaveLength(7)
    } finally {
      await db.grant.deleteMany({ where: { walletId: wallet.id } })
      await db.authorizationRequest.deleteMany({ where: { agentId } })
      await db.agent.deleteMany({ where: { walletId: wallet.id } })
      await db.wallet.delete({ where: { id: wallet.id } })
    }
  })
})
