import { afterEach, describe, expect, it, vi } from "vitest"
import { withTenant } from "../lib/rls"
import { db } from "../lib/db"
import { startWalkthrough, advanceWalkthrough, receiveWalkthroughCall, walkthroughView } from "../lib/brokerWalkthrough"
import { resolveApproval } from "../lib/approvals"
import { subtreeWalletIds } from "../lib/walletSubtree"
import { upsertPolicyWithRevision } from "../lib/policy"
vi.mock("next/server", async orig => ({ ...await orig<typeof import("next/server")>(), after: () => {} }))
const owners: string[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  if (process.env.RUN_DB_TESTS !== "1") return
  for (const owner of owners.splice(0)) {
    const { ids } = await subtreeWalletIds(owner)
    const agents = await db.agent.findMany({ where: { walletId: { in: ids } }, select: { id: true } })
    await db.grant.deleteMany({ where: { walletId: { in: ids } } })
    await db.pendingApproval.deleteMany({ where: { walletId: { in: ids } } })
    await db.authorizationRequest.deleteMany({ where: { agentId: { in: agents.map(a => a.id) } } })
    await db.agent.deleteMany({ where: { walletId: { in: ids } } })
    await db.brokerWalkthrough.deleteMany({ where: { ownerWalletId: owner } })
    await db.policyRevision.deleteMany({ where: { walletId: { in: ids } } })
    await db.policy.deleteMany({ where: { walletId: { in: ids } } })
    await withTenant(ids, tx => tx.credentialVault.deleteMany({ where: { walletId: { in: ids } } }))
    await db.walletKey.deleteMany({ where: { walletId: { in: ids } } })
    await db.wallet.deleteMany({ where: { id: { in: ids } } })
  }
})
async function owner() {
  const w = await db.wallet.create({ data: { name: "walkthrough-test", ownerEmail: `proof-${crypto.randomUUID()}@example.test` } })
  owners.push(w.id)
  return w.id
}
function wireUpstream() {
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const id = new URL(url).pathname.split("/").pop()!
    const result = await receiveWalkthroughCall(id, new Headers(init.headers).get("authorization"), JSON.parse(String(init.body)))
    return Response.json(result ?? { error: "Unauthorized" }, { status: result ? 200 : 401 })
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}
describe.skipIf(process.env.RUN_DB_TESTS !== "1")("broker walkthrough (real DB and decision engine)", () => {
  it("proves the full approval loop and serializes repeated clicks", async () => {
    const walletId = await owner()
    const [id, duplicate] = await Promise.all([startWalkthrough(walletId), startWalkthrough(walletId)])
    expect(id).toBe(duplicate)
    const fetchMock = wireUpstream()
    // Either click may win the walkthrough lock; the loser sees "pending" with no grant yet and throws.
    const firstClicks = await Promise.allSettled([advanceWalkthrough(walletId, id), advanceWalkthrough(walletId, id)])
    expect(firstClicks.filter(r => r.status === "fulfilled")).toHaveLength(1)
    let view = await walkthroughView(walletId)
    expect(view).toMatchObject({ state: "pending", initialStopped: true, executionCount: 0 })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(JSON.stringify(view)).not.toMatch(/encryptedAgentKey|upstreamTokenHash/)
    expect((await resolveApproval((await subtreeWalletIds(walletId)).ids, view!.approval!.id, "approve")).ok).toBe(true)
    await Promise.all([advanceWalkthrough(walletId, id), advanceWalkthrough(walletId, id)])
    view = await walkthroughView(walletId)
    expect(view).toMatchObject({ state: "completed", executionCount: 1, changedStopped: true, reuseStopped: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).params._meta).toBeUndefined()
    expect(view!.completedAt).not.toBeNull()
  })
  it("preserves inherited denial and never forwards", async () => {
    const walletId = await owner()
    await db.$transaction(tx => upsertPolicyWithRevision(tx, walletId, { blockedTools: ["filesystem.read_file"] }))
    const id = await startWalkthrough(walletId)
    const fetchMock = wireUpstream()
    await advanceWalkthrough(walletId, id)
    expect(await walkthroughView(walletId)).toMatchObject({ state: "failed", executionCount: 0 })
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it("rejects another owner, a wrong upstream token, and expired trials", async () => {
    const a = await owner(), b = await owner()
    const id = await startWalkthrough(a)
    await expect(advanceWalkthrough(b, id)).rejects.toThrow("not found")
    expect(await walkthroughView(b)).toBeNull()
    expect(await receiveWalkthroughCall(id, "Bearer pxy_wrong", { method: "tools/call" })).toBeNull()
    const run = await db.brokerWalkthrough.findUniqueOrThrow({ where: { id } })
    await db.wallet.update({ where: { id: run.testWalletId }, data: { parentId: b } })
    await expect(advanceWalkthrough(a, id)).rejects.toThrow("not found")
    expect(await walkthroughView(a)).toBeNull()
    await db.wallet.update({ where: { id: run.testWalletId }, data: { parentId: a } })
    await db.brokerWalkthrough.update({ where: { id }, data: { expiresAt: new Date(0) } })
    await expect(advanceWalkthrough(a, id)).rejects.toThrow("expired")
  })
  it("does not claim completion after an uncertain upstream outcome", async () => {
    const walletId = await owner(), id = await startWalkthrough(walletId)
    await advanceWalkthrough(walletId, id)
    const view = await walkthroughView(walletId)
    await resolveApproval((await subtreeWalletIds(walletId)).ids, view!.approval!.id, "approve")
    vi.stubGlobal("fetch", vi.fn(async () => { throw Error("timeout") }))
    await advanceWalkthrough(walletId, id)
    expect(await walkthroughView(walletId)).toMatchObject({ state: "failed", completedAt: null })
  })
})
