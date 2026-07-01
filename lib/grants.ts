import type { db } from "./db"
import { reserveCascadeDailySpend, type CascadeTx, type WalletBudgetNode } from "./cascadeBudget"
import type { DecisionCode } from "./decisions"

export type GrantErrorCode = Extract<
  DecisionCode,
  | "EXEC_BUDGET_EXCEEDED"
  | "GRANT_NOT_FOUND"
  | "GRANT_ALREADY_USED"
  | "GRANT_EXPIRED"
  | "GRANT_MISMATCH"
  | "GRANT_UNSUPPORTED"
  | "POLICY_DENIED"
>

export type GrantConsumeResult =
  | { ok: true; request: SpendRequest; grantId: string; grantExpiresAt: Date | null; consumedAt: Date }
  | { ok: false; code: GrantErrorCode; status: 403 | 404 | 409; reason: string }

type GrantClient = CascadeTx & Pick<typeof db, "authorizationRequest" | "executionToken" | "grant">

type SpendRequest = {
  id: string
  status: string
  decisionNote: string | null
  amountUsd: number
  merchant: string
  decidedAt: Date | null
}

type SpendGrant = {
  id: string
  walletId: string
  agentId: string
  actionType: string
  status: string
  resourceJson: unknown
  sourceType: string | null
  sourceId: string | null
  expiresAt: Date | null
}

export type SpendGrantRequest = {
  action: string
  amountUsd: number
  amountCents: number
  merchant: string
  category: string
  description?: string
}

// Must run inside the caller's transaction: a parent-cap failure after the
// guarded consume update relies on rollback to leave the grant active.
export async function consumeSpendGrant(
  client: GrantClient,
  input: {
    grantId: string
    walletId: string
    agentId: string
    request: SpendGrantRequest
    ancestorChain: WalletBudgetNode[]
    execTokenId: string | null
    now?: Date
  },
): Promise<GrantConsumeResult> {
  const now = input.now ?? new Date()
  const grant = await client.grant.findUnique({ where: { id: input.grantId } }) as SpendGrant | null

  if (!grant || grant.walletId !== input.walletId || grant.agentId !== input.agentId) {
    return denyGrant("GRANT_NOT_FOUND", 404, "Grant not found")
  }
  if (grant.actionType !== `spend.${input.request.action}` || grant.sourceType !== "authorization_request" || !grant.sourceId) {
    return denyGrant("GRANT_UNSUPPORTED", 403, "Grant is not valid for this spend request")
  }
  if (grant.status === "consumed") return denyGrant("GRANT_ALREADY_USED", 409, "Grant already consumed")
  if (grant.status !== "active") return denyGrant("GRANT_NOT_FOUND", 404, `Grant is ${grant.status}`)
  if (grant.expiresAt && grant.expiresAt <= now) {
    await client.grant.updateMany({ where: { id: grant.id, status: "active" }, data: { status: "expired" } })
    return denyGrant("GRANT_EXPIRED", 403, "Grant expired")
  }
  if (!spendGrantMatches(grant.resourceJson, input.request)) {
    return denyGrant("GRANT_MISMATCH", 403, "Grant does not authorize this spend request")
  }

  if (input.execTokenId) {
    const exec = await client.executionToken.findUnique({ where: { id: input.execTokenId } })
    if (!exec || exec.status !== "active" || exec.expiresAt < now) {
      return denyGrant("POLICY_DENIED", 403, "Execution token expired or revoked")
    }
    if (Math.round((exec.spentUsd + input.request.amountUsd) * 100) > Math.round(exec.budgetUsd * 100)) {
      return denyGrant("EXEC_BUDGET_EXCEEDED", 403, "Execution budget exceeded")
    }
  }

  const consumed = await client.grant.updateMany({
    where: { id: grant.id, status: "active", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    data: { status: "consumed", consumedAt: now },
  })
  if (consumed.count === 0) return denyGrant("GRANT_ALREADY_USED", 409, "Grant already consumed")

  await reserveCascadeDailySpend(client, input.walletId, input.request.amountCents, now, input.ancestorChain)

  const request = await client.authorizationRequest.update({
    where: { id: grant.sourceId },
    data: { status: "approved", decidedAt: now, decisionNote: "Grant consumed" },
  })
  if (input.execTokenId) {
    await client.executionToken.update({ where: { id: input.execTokenId }, data: { spentUsd: { increment: input.request.amountUsd } } })
  }

  return { ok: true, request, grantId: grant.id, grantExpiresAt: grant.expiresAt, consumedAt: now }
}

export function spendGrantMatches(resourceJson: unknown, request: SpendGrantRequest): boolean {
  const resource = asRecord(resourceJson)
  const approvedAmount = typeof resource.amount_usd === "number" ? Math.round(resource.amount_usd * 100) : null
  const approvedDescription = stringValue(resource.description)
  const requestDescription = stringValue(request.description)

  return (
    resource.kind === "spend" &&
    resource.action === request.action &&
    approvedAmount === request.amountCents &&
    resource.merchant === request.merchant &&
    resource.category === request.category &&
    approvedDescription === requestDescription
  )
}

function denyGrant(code: GrantErrorCode, status: 403 | 404 | 409, reason: string): GrantConsumeResult {
  return { ok: false, code, status, reason }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null
}
