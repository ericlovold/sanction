/**
 * SEC-3: Tenant-scoped DB helper.
 *
 * Every query against tenant-owned tables (CredentialVault, Agent,
 * ExecutionToken, TokenLog, AuthorizationRequest, PendingApproval, Grant, AgentClearance,
 * CredentialInjection) MUST go through this module, not raw `db`.
 *
 * Each method enforces the walletId at the query layer, so a bug in a route
 * that passes the wrong walletId produces a 404 rather than a cross-tenant
 * data leak. This is defence-in-depth on top of the JWT aud binding (SEC-5)
 * and the AAD encryption binding (SEC-1/SEC-2).
 *
 * Postgres-level RLS (the ultimate defence) is the next step; this middleware
 * layer buys the same protection today without requiring a DB migration.
 */

import { db } from "./db"

// ── Credential Vault ──────────────────────────────────────────────────────────

export async function getCredential(walletId: string, label: string) {
  return db.credentialVault.findFirst({
    where: { walletId, label },
  })
}

export async function listCredentials(walletId: string) {
  return db.credentialVault.findMany({
    where: { walletId },
    select: {
      id: true, label: true, type: true, scopes: true,
      allowedAgentIds: true, minClearance: true, expiresAt: true, createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  })
}

export async function createCredential(
  walletId: string,
  data: {
    label: string
    type: string
    encryptedValue: string
    allowedAgentIds: string[]
    scopes: string[]
    minClearance: number
    expiresAt?: Date
  },
) {
  return db.credentialVault.create({
    data: { walletId, ...data },
    select: {
      id: true, label: true, type: true, scopes: true,
      allowedAgentIds: true, minClearance: true, createdAt: true,
    },
  })
}

// ── Agents ────────────────────────────────────────────────────────────────────

export async function listAgents(walletId: string) {
  return db.agent.findMany({
    where: { walletId },
    select: {
      id: true, name: true, apiKeyPrefix: true, isActive: true, createdAt: true,
      dailySpendBudgetUsd: true, dailyTokenBudgetUsd: true, perTransactionMaxUsd: true,
    },
    orderBy: { createdAt: "desc" },
  })
}

export async function getAgent(walletId: string, agentId: string) {
  return db.agent.findFirst({ where: { id: agentId, walletId } })
}

// ── Authorization Requests ────────────────────────────────────────────────────

export async function listRequests(walletId: string, status?: string, limit = 50) {
  return db.authorizationRequest.findMany({
    where: {
      agent: { walletId },
      ...(status ? { status } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { agent: { select: { name: true } } },
  })
}

// ── Wallet stats ──────────────────────────────────────────────────────────────

export async function walletStats(walletId: string) {
  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)

  const [dailySpend, pendingApprovals, agents] = await Promise.all([
    db.authorizationRequest.aggregate({
      where: { agent: { walletId }, status: "approved", createdAt: { gte: dayStart } },
      _sum: { amountUsd: true },
    }),
    db.pendingApproval.count({ where: { walletId, status: "pending" } }),
    db.agent.count({ where: { walletId } }),
  ])

  return {
    daily_spend_usd: dailySpend._sum.amountUsd ?? 0,
    pending_escalations: pendingApprovals,
    pending_approvals: pendingApprovals,
    agent_count: agents,
  }
}
