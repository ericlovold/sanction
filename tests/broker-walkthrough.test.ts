import { beforeEach, describe, expect, it, vi } from "vitest"
import { hashApiKey } from "../lib/apiKey"
const { mock } = vi.hoisted(() => ({ mock: {
  brokerWalkthrough: { findFirst: vi.fn(), update: vi.fn() }, pendingApproval: { findFirst: vi.fn() },
} }))
vi.mock("@/lib/walletSubtree", () => ({ subtreeWalletIds: async () => ({ ids: ["owner", "child"] }) }))
vi.mock("@/lib/db", () => ({ db: mock }))
vi.mock("@/app/mcp/broker/[upstream]/route", () => ({ POST: vi.fn() }))
import { receiveWalkthroughCall, walkthroughView } from "../lib/brokerWalkthrough"
beforeEach(() => vi.clearAllMocks())
describe("walkthrough evidence boundary", () => {
  it("rejects missing and wrong credentials without incrementing the receipt", async () => {
    expect(await receiveWalkthroughCall("trial", null, {})).toBeNull()
    expect(mock.brokerWalkthrough.findFirst).not.toHaveBeenCalled()
    mock.brokerWalkthrough.findFirst.mockResolvedValue({ upstreamTokenHash: hashApiKey("upstream-token") })
    expect(await receiveWalkthroughCall("trial", "Bearer agent-key", {})).toBeNull()
    expect(mock.brokerWalkthrough.update).not.toHaveBeenCalled()
  })
  it("counts every authenticated tool invocation, including mutated arguments", async () => {
    mock.brokerWalkthrough.findFirst.mockResolvedValue({ upstreamTokenHash: hashApiKey("upstream-token") })
    const r = await receiveWalkthroughCall("trial", "Bearer upstream-token", { method: "tools/call", id: 7, params: { name: "unexpected", arguments: { path: "changed" } } })
    expect(r).toMatchObject({ id: 7, result: { content: [{ text: "Sanction walkthrough: harmless read completed." }] } })
    expect(mock.brokerWalkthrough.update).toHaveBeenCalledWith({ where: { id: "trial" }, data: { executionCount: { increment: 1 } } })
  })
  it("does not count protocol messages as tool executions", async () => {
    mock.brokerWalkthrough.findFirst.mockResolvedValue({ upstreamTokenHash: hashApiKey("upstream-token") })
    expect(await receiveWalkthroughCall("trial", "Bearer upstream-token", { method: "ping", id: 1 })).toMatchObject({ error: { code: -32601 } })
    expect(mock.brokerWalkthrough.update).not.toHaveBeenCalled()
  })
  it("scopes owner reads and selects no credentials", async () => {
    mock.brokerWalkthrough.findFirst.mockResolvedValue(null)
    expect(await walkthroughView("owner")).toBeNull()
    const query = mock.brokerWalkthrough.findFirst.mock.calls[0][0]
    expect(query.where).toEqual({ ownerWalletId: "owner" })
    expect(query.select).not.toHaveProperty("encryptedAgentKey")
    expect(query.select).not.toHaveProperty("upstreamTokenHash")
  })
  it("binds the approval lookup to the test wallet", async () => {
    mock.brokerWalkthrough.findFirst.mockResolvedValue({ id: "trial", requestId: "request", testWalletId: "child", expiresAt: new Date(), completedAt: null })
    mock.pendingApproval.findFirst.mockResolvedValue({ id: "approval", status: "pending" })
    expect(await walkthroughView("owner")).toMatchObject({ approval: { status: "pending" } })
    expect(mock.pendingApproval.findFirst).toHaveBeenCalledWith({ where: { walletId: "child", sourceType: "authorization_request", sourceId: "request" }, select: { id: true, status: true } })
  })
})
