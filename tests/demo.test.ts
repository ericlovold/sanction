import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// lib/demo.ts guards against client bundling with `import "server-only"`, which
// throws under vitest's node env — stub it. Then mock the db it reads.
vi.mock("server-only", () => ({}))

const dbMock = vi.hoisted(() => ({
  pendingApproval: { findMany: vi.fn() },
  agent: { findMany: vi.fn() },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))

// getDemoEscalation resolves the demo subtree; stub it to the demo wallet id so
// the pendingApproval mock drives the test (the where-clause is a no-op on a mock).
vi.mock("@/lib/walletSubtree", () => ({
  subtreeWalletIds: vi.fn(async (id: string) => ({ ids: [id], truncated: false })),
}))

import { getDemoEscalation } from "@/lib/demo"

const OLD_ENV = process.env.SANCTION_WALLET_ID

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SANCTION_WALLET_ID = "demo-wallet"
  dbMock.agent.findMany.mockResolvedValue([
    { id: "a1", name: "discovery-agent" },
    { id: "a2", name: "triage-agent" },
  ])
})

afterEach(() => {
  process.env.SANCTION_WALLET_ID = OLD_ENV
})

describe("getDemoEscalation", () => {
  it("returns null when the demo wallet isn't configured", async () => {
    delete process.env.SANCTION_WALLET_ID
    expect(await getDemoEscalation()).toBeNull()
    expect(dbMock.pendingApproval.findMany).not.toHaveBeenCalled()
  })

  it("returns null when there are no pending escalations", async () => {
    dbMock.pendingApproval.findMany.mockResolvedValue([])
    expect(await getDemoEscalation()).toBeNull()
  })

  it("prefers a money decision (amount + merchant) over a bare tool toggle", async () => {
    dbMock.pendingApproval.findMany.mockResolvedValue([
      { id: "p1", agentId: "a2", actionType: "tool.invoke", reason: "Tool needs approval", resourceJson: {} },
      { id: "p2", agentId: "a1", actionType: "spend", reason: "Exceeds threshold", resourceJson: { merchant: "Rule 26 Experts LLC", amount_usd: 450 } },
    ])
    const esc = await getDemoEscalation()
    expect(esc).toMatchObject({ id: "p2", agent: "discovery-agent", merchant: "Rule 26 Experts LLC", amount: 450 })
  })

  it("falls back to the oldest pending when none is a money decision", async () => {
    dbMock.pendingApproval.findMany.mockResolvedValue([
      { id: "p1", agentId: "a2", actionType: "tool.invoke", reason: "email.send", resourceJson: {} },
      { id: "p3", agentId: "a1", actionType: "tool.invoke", reason: "docusign.send", resourceJson: {} },
    ])
    const esc = await getDemoEscalation()
    expect(esc?.id).toBe("p1")
    expect(esc?.amount).toBeNull()
    expect(esc?.merchant).toBeNull()
  })

  it("reads amount from amountUsd and merchant from resource as fallbacks", async () => {
    dbMock.pendingApproval.findMany.mockResolvedValue([
      { id: "p4", agentId: "a1", actionType: "spend", reason: null, resourceJson: { resource: "Google Ads", amountUsd: 12 } },
    ])
    const esc = await getDemoEscalation()
    expect(esc).toMatchObject({ merchant: "Google Ads", amount: 12 })
  })

  it("uses a safe fallback name for an unknown agent", async () => {
    dbMock.agent.findMany.mockResolvedValue([])
    dbMock.pendingApproval.findMany.mockResolvedValue([
      { id: "p5", agentId: "ghost", actionType: "spend", reason: null, resourceJson: { merchant: "X", amount_usd: 5 } },
    ])
    const esc = await getDemoEscalation()
    expect(esc?.agent).toBe("agent")
  })
})
