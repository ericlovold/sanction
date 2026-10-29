import { createHash, randomUUID, timingSafeEqual } from "node:crypto"
import { NextRequest } from "next/server"
import { db } from "./db"
import { generateApiKey, hashApiKey } from "./apiKey"
import { encryptCredentialEnvelope, decryptCredentialEnvelope } from "./credentialCrypto"
import { upsertPolicyWithRevision } from "./policy"
import { subtreeWalletIds } from "./walletSubtree"
import { withTenant } from "./rls"
import { POST as brokerPOST } from "@/app/mcp/broker/[upstream]/route"

export const WALKTHROUGH_TOOL = "filesystem.read_file"
const UPSTREAM = "sanction-walkthrough"
const LABEL = "walkthrough-agent"
const ARGS = { path: "sanction-demo.txt" }

function origin() {
  const url = new URL(process.env.SANCTION_PUBLIC_ORIGIN || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://getsanction.com"))
  if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.hostname === "localhost")) throw new Error("Walkthrough requires HTTPS")
  return url.origin
}

export async function startWalkthrough(ownerWalletId: string) {
  return prepareWalkthrough(ownerWalletId)
}

export async function restartWalkthrough(ownerWalletId: string, previousId: string) {
  return prepareWalkthrough(ownerWalletId, previousId)
}

const replacementId = (id: string) => `restart-${createHash("sha256").update(id).digest("hex")}`
type RestartRun = { requestId: string | null; state: string; initialStopped: boolean; executionCount: number; changedStopped: boolean; completedAt: Date | null; expiresAt: Date }
type RestartApproval = { id: string; status: string; expiresAt: Date | null; constraintsJson: unknown }
type RestartGrant = { sourceType: string | null; sourceId: string | null; issuedFromApprovalId: string | null; status: string; expiresAt: Date | null; consumedAt: Date | null; revokedAt: Date | null }

function restartReason(run: RestartRun, approval: RestartApproval | null, grants: RestartGrant[], now = new Date()) {
  if (run.state !== "pending" || !run.initialStopped || run.executionCount !== 0 || run.changedStopped || run.completedAt || run.expiresAt <= now || !approval) return null
  const expired = (date: Date | null) => date !== null && date <= now
  if (["pending", "expired"].includes(approval.status) && expired(approval.expiresAt) && grants.length === 0) {
    // Never replace a timeout that could still mint authority.
    const constraints = approval.constraintsJson as { timeout_action?: string } | null
    return constraints?.timeout_action === "deny" ? "approval_expired" as const : null
  }
  if (approval.status === "approved" && grants.length > 0 && grants.every(g => g.sourceType === "authorization_request" && g.sourceId === run.requestId && g.issuedFromApprovalId === approval.id && ["active", "expired"].includes(g.status) && expired(g.expiresAt) && !g.consumedAt && !g.revokedAt)) return "grant_expired" as const
  return null
}

async function prepareWalkthrough(ownerWalletId: string, previousId?: string) {
  // Serialize setup per owner; repeat clicks return the existing live trial.
  const key = generateApiKey()
  const token = randomUUID()
  const run = await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`walkthrough-owner:${ownerWalletId}`}))`
    if (previousId !== undefined) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`walkthrough:${previousId}`}))`
      await tx.$queryRaw`SELECT id FROM "BrokerWalkthrough" WHERE id = ${previousId} AND "ownerWalletId" = ${ownerWalletId} FOR UPDATE`
      const previous = await tx.brokerWalkthrough.findFirst({ where: { id: previousId, ownerWalletId } })
      const { ids } = await subtreeWalletIds(ownerWalletId)
      if (!previous || !ids.includes(previous.testWalletId)) throw new Error("Walkthrough not found")
      if (previous.state === "restarted") {
        const replacement = await tx.brokerWalkthrough.findFirst({ where: { id: replacementId(previousId), ownerWalletId, testWalletId: { in: ids } } })
        if (!replacement) throw new Error("Replacement unavailable")
        return { row: replacement, fresh: false }
      }
      if (!previous.requestId) throw new Error("Walkthrough cannot restart")
      // Resolution uses a guarded update on this row. Holding it prevents an
      // approval read before expiry from minting a grant during replacement.
      await tx.$queryRaw`SELECT id FROM "PendingApproval" WHERE "walletId" = ${previous.testWalletId} AND "sourceType" = 'authorization_request' AND "sourceId" = ${previous.requestId} FOR UPDATE`
      await tx.$queryRaw`SELECT id FROM "Grant" WHERE "walletId" = ${previous.testWalletId} AND "agentId" = ${previous.agentId} FOR UPDATE`
      const approval = await tx.pendingApproval.findFirst({ where: { walletId: previous.testWalletId, agentId: previous.agentId, sourceType: "authorization_request", sourceId: previous.requestId } })
      const grants = await tx.grant.findMany({ where: { walletId: previous.testWalletId, agentId: previous.agentId } })
      if (!restartReason(previous, approval, grants)) throw new Error("Walkthrough cannot restart")
      const now = new Date()
      if (approval!.status === "pending") {
        const constraints = approval!.constraintsJson as { timeout_mins?: number } | null
        const timeoutMins = constraints?.timeout_mins ?? Math.max(0, Math.round((approval!.expiresAt!.getTime() - approval!.createdAt.getTime()) / 60_000))
        const decisionNote = `Escalation timed out after ${timeoutMins}m — auto-denied by policy`
        await tx.pendingApproval.update({ where: { id: approval!.id, walletId: previous.testWalletId }, data: { status: "expired", resolvedAt: now, resolvedBy: "policy_timeout", resolutionNote: decisionNote } })
        await tx.authorizationRequest.updateMany({ where: { id: previous.requestId, agentId: previous.agentId, status: "escalated" }, data: { status: "denied", decidedAt: now, decisionNote } })
      }
      await tx.grant.updateMany({ where: { walletId: previous.testWalletId, agentId: previous.agentId, status: "active", consumedAt: null, expiresAt: { lte: now } }, data: { status: "expired" } })
      await tx.agent.update({ where: { id: previous.agentId, walletId: previous.testWalletId }, data: { isActive: false } })
      await tx.brokerWalkthrough.update({ where: { id: previous.id, ownerWalletId }, data: { state: "restarted" } })
    } else {
      const existing = await tx.brokerWalkthrough.findFirst({ where: { ownerWalletId, state: { not: "restarted" }, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } })
      if (existing) return { row: existing, fresh: false }
    }
    const wallet = await tx.wallet.create({ data: { name: "Broker walkthrough (test)", ownerEmail: `walkthrough-${randomUUID()}@example.invalid`, parentId: ownerWalletId } })
    await upsertPolicyWithRevision(tx, wallet.id, { allowedTools: [WALKTHROUGH_TOOL], escalateTools: [WALKTHROUGH_TOOL], enforcementMode: "enforce", escalationTimeoutAction: "deny", escalationTimeoutMins: 30, perTransactionMaxUsd: 0, dailySpendBudgetUsd: 0, dailyTokenBudgetUsd: 0, capabilityRules: [{ pattern: "*", effect: "block" }] })
    const expiresAt = new Date(Date.now() + 60 * 60_000)
    const agent = await tx.agent.create({ data: { walletId: wallet.id, name: "Broker walkthrough (test)", apiKeyHash: key.hash, apiKeyPrefix: key.prefix, expiresAt } })
    return { row: await tx.brokerWalkthrough.create({ data: { ...(previousId !== undefined ? { id: replacementId(previousId) } : {}), ownerWalletId, testWalletId: wallet.id, agentId: agent.id, upstreamTokenHash: hashApiKey(token), expiresAt } }), fresh: true }
  })
  if (!run.fresh) return run.row.id
  try {
    const agentSecret = await encryptCredentialEnvelope(key.raw, run.row.testWalletId, LABEL)
    const upstreamSecret = await encryptCredentialEnvelope(JSON.stringify({ url: `${origin()}/api/walkthrough/upstream/${run.row.id}`, auth_header: "authorization", auth_value: `Bearer ${token}` }), run.row.testWalletId, `mcp:${UPSTREAM}`)
    await withTenant(run.row.testWalletId, tx => tx.credentialVault.create({ data: { walletId: run.row.testWalletId, label: `mcp:${UPSTREAM}`, type: "api_key", encryptedValue: upstreamSecret.blob, keyId: upstreamSecret.keyId, minClearance: 5, allowedAgentIds: ["broker-internal-only"], scopes: ["mcp-broker"] } }))
    await db.brokerWalkthrough.update({ where: { id: run.row.id }, data: { encryptedAgentKey: agentSecret.blob, keyId: agentSecret.keyId, state: "ready" } })
  } catch (error) {
    await db.brokerWalkthrough.update({ where: { id: run.row.id }, data: { state: "failed" } })
    await db.agent.update({ where: { id: run.row.agentId }, data: { isActive: false } })
    throw error
  }
  return run.row.id
}

// Completed evidence remains valid after the temporary agent expires.
export async function completedWalkthroughProof(ownerWalletId: string) {
  const { ids } = await subtreeWalletIds(ownerWalletId)
  return db.brokerWalkthrough.findFirst({
    where: {
      ownerWalletId,
      testWalletId: { in: ids },
      state: "completed",
      completedAt: { not: null },
      initialStopped: true,
      changedStopped: true,
      reuseStopped: true,
      executionCount: 1,
    },
    orderBy: { completedAt: "desc" },
    select: { id: true, completedAt: true },
  })
}

// Scope every management read to the authenticated wallet. No secrets reach UI.
export async function walkthroughView(ownerWalletId: string, runId?: string) {
  const run = await db.brokerWalkthrough.findFirst({ where: { ownerWalletId, ...(runId !== undefined ? { id: runId } : {}) }, orderBy: { createdAt: "desc" }, select: { id: true, state: true, requestId: true, initialStopped: true, changedStopped: true, reuseStopped: true, executionCount: true, completedAt: true, expiresAt: true, testWalletId: true, agentId: true } })
  if (!run || !(await subtreeWalletIds(ownerWalletId)).ids.includes(run.testWalletId)) return null
  const approval = run.requestId ? await db.pendingApproval.findFirst({ where: { walletId: run.testWalletId, sourceType: "authorization_request", sourceId: run.requestId }, select: { id: true, status: true, expiresAt: true, constraintsJson: true } }) : null
  const grants = run.requestId ? await db.grant.findMany({ where: { walletId: run.testWalletId, agentId: run.agentId }, select: { sourceType: true, sourceId: true, issuedFromApprovalId: true, status: true, expiresAt: true, consumedAt: true, revokedAt: true } }) : []
  const reason = restartReason(run, approval, grants)
  const { agentId: _agentId, ...visibleRun } = run
  return { ...visibleRun, approval: approval ? { id: approval.id, status: approval.status === "pending" && approval.expiresAt && approval.expiresAt <= new Date() ? "expired" : approval.status } : null, restartReason: reason, replacementId: run.state === "restarted" ? replacementId(run.id) : null, expiresAt: run.expiresAt.toISOString(), completedAt: run.completedAt?.toISOString() ?? null }
}

export async function advanceWalkthrough(ownerWalletId: string, id: string) {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`walkthrough-owner:${ownerWalletId}`}))`
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`walkthrough:${id}`}))`
    const run = await tx.brokerWalkthrough.findFirst({ where: { id, ownerWalletId } })
    if (!run || !(await subtreeWalletIds(ownerWalletId)).ids.includes(run.testWalletId)) throw new Error("Walkthrough not found")
    if (run.state === "completed") return
    if (run.expiresAt <= new Date()) throw new Error("Walkthrough expired. Start a new walkthrough.")
    if (!run.encryptedAgentKey || !run.keyId || !["ready", "pending"].includes(run.state)) throw new Error("Walkthrough is unavailable")
    const key = await decryptCredentialEnvelope({ walletId: run.testWalletId, label: LABEL, encryptedValue: run.encryptedAgentKey, keyId: run.keyId })
    const call = async (args: Record<string, unknown>, grantId?: string) => {
      const response = await brokerPOST(new NextRequest(`${origin()}/mcp/broker/${UPSTREAM}`, { method: "POST", headers: { "x-api-key": key, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: WALKTHROUGH_TOOL, arguments: args, ...(grantId ? { _meta: { "sanction/grant_id": grantId } } : {}) } }) }), { params: Promise.resolve({ upstream: UPSTREAM }) })
      const body = await response.json()
      return { refused: response.ok && body.result?.isError === true, succeeded: response.ok && body.result?.isError !== true && body.result?.content?.[0]?.text === "Sanction walkthrough: harmless read completed." }
    }
    const count = async () => (await tx.brokerWalkthrough.findUniqueOrThrow({ where: { id } })).executionCount
    if (run.state === "ready") {
      const result = await call(ARGS)
      const request = await tx.authorizationRequest.findFirst({ where: { agentId: run.agentId, kind: "tool", status: "escalated" } })
      const stopped = result.refused && !!request && await count() === 0
      await tx.brokerWalkthrough.update({ where: { id }, data: { state: stopped ? "pending" : "failed", initialStopped: stopped, requestId: request?.id } })
      return
    }
    const grant = await tx.grant.findFirst({ where: { walletId: run.testWalletId, agentId: run.agentId, sourceType: "authorization_request", sourceId: run.requestId, status: "active" } })
    if (!grant || (grant.expiresAt && grant.expiresAt <= new Date())) throw new Error("Approve the request in Approvals first. Denied or expired requests cannot continue.")
    const changed = await call({ path: "changed-demo.txt" }, grant.id)
    const stillActive = await tx.grant.findFirst({ where: { id: grant.id, walletId: run.testWalletId, status: "active" } })
    const changedStopped = changed.refused && !!stillActive && await count() === 0
    if (!changedStopped) {
      await tx.brokerWalkthrough.update({ where: { id }, data: { state: "failed" } })
      return
    }
    const executed = await call(ARGS, grant.id)
    const consumed = await tx.grant.findFirst({ where: { id: grant.id, walletId: run.testWalletId, status: "consumed" } })
    if (!executed.succeeded || !consumed || await count() !== 1) {
      await tx.brokerWalkthrough.update({ where: { id }, data: { state: "failed", changedStopped } })
      return
    }
    const reuse = await call(ARGS, grant.id)
    const reuseStopped = reuse.refused && await count() === 1
    await tx.brokerWalkthrough.update({ where: { id }, data: { changedStopped, reuseStopped, state: reuseStopped ? "completed" : "failed", completedAt: reuseStopped ? new Date() : null } })
    await tx.agent.update({ where: { id: run.agentId }, data: { isActive: false } })
  }, { timeout: 120_000 })
}

// Only this upstream path records execution. Caller supplies the separately
// vaulted upstream token, never a Sanction agent key. No filesystem IO occurs.
export async function receiveWalkthroughCall(id: string, authorization: string | null, body: unknown) {
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : ""
  if (!token) return null
  const run = await db.brokerWalkthrough.findFirst({ where: { id, state: { not: "restarted" }, expiresAt: { gt: new Date() } } })
  if (!run || run.upstreamTokenHash.length !== 64 || !timingSafeEqual(Buffer.from(hashApiKey(token)), Buffer.from(run.upstreamTokenHash))) return null
  const msg = body as { id?: number | string; method?: string; params?: { name?: string } } | null
  if (msg?.method !== "tools/call") return { jsonrpc: "2.0", id: msg?.id ?? null, error: { code: -32601, message: "Only the walkthrough tool call is supported" } }
  // Count every forwarded invocation, including a wrong tool or arguments.
  const recorded = await db.brokerWalkthrough.updateMany({ where: { id, state: { not: "restarted" }, expiresAt: { gt: new Date() } }, data: { executionCount: { increment: 1 } } })
  if (recorded.count !== 1) return null
  return { jsonrpc: "2.0", id: msg.id ?? null, result: { content: [{ type: "text", text: "Sanction walkthrough: harmless read completed." }] } }
}
