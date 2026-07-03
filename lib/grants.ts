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

export type ProvisionGrantRequest = {
  resource: string
  lineItem: string
  quantity: number
  amountUsd: number
  amountCents: number
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
  return consumeGrantCore(client, {
    ...input,
    amountUsd: input.request.amountUsd,
    amountCents: input.request.amountCents,
    expectedActionType: `spend.${input.request.action}`,
    matches: (resourceJson) => spendGrantMatches(resourceJson, input.request),
    unsupportedReason: "Grant is not valid for this spend request",
    mismatchReason: "Grant does not authorize this spend request",
  })
}

// Same flow, provision shape: the grant must carry the exact provision the owner
// approved (resource, line item, quantity, amount). Runs inside the caller's
// transaction like consumeSpendGrant.
export async function consumeProvisionGrant(
  client: GrantClient,
  input: {
    grantId: string
    walletId: string
    agentId: string
    request: ProvisionGrantRequest
    ancestorChain: WalletBudgetNode[]
    execTokenId: string | null
    now?: Date
  },
): Promise<GrantConsumeResult> {
  return consumeGrantCore(client, {
    ...input,
    amountUsd: input.request.amountUsd,
    amountCents: input.request.amountCents,
    expectedActionType: "provision.allocate",
    matches: (resourceJson) => provisionGrantMatches(resourceJson, input.request),
    unsupportedReason: "Grant is not valid for this provision request",
    mismatchReason: "Grant does not authorize this provision request",
  })
}

export type ToolGrantRequest = {
  tool: string
  server?: string
}

// Tool grants carry no dollar amount — the cascade reserve is a 0-cent no-op —
// but consumption is still one-use, expiring, and settles the source request.
// Runs inside the caller's transaction like the other consumers.
export async function consumeToolGrant(
  client: GrantClient,
  input: {
    grantId: string
    walletId: string
    agentId: string
    request: ToolGrantRequest
    now?: Date
  },
): Promise<GrantConsumeResult> {
  return consumeGrantCore(client, {
    ...input,
    amountUsd: 0,
    amountCents: 0,
    ancestorChain: [],
    execTokenId: null,
    expectedActionType: "tool.invoke",
    matches: (resourceJson) => toolGrantMatches(resourceJson, input.request),
    unsupportedReason: "Grant is not valid for this tool invocation",
    mismatchReason: "Grant does not authorize this tool invocation",
  })
}

async function consumeGrantCore(
  client: GrantClient,
  input: {
    grantId: string
    walletId: string
    agentId: string
    amountUsd: number
    amountCents: number
    ancestorChain: WalletBudgetNode[]
    execTokenId: string | null
    now?: Date
    expectedActionType: string
    matches: (resourceJson: unknown) => boolean
    unsupportedReason: string
    mismatchReason: string
  },
): Promise<GrantConsumeResult> {
  const now = input.now ?? new Date()
  const grant = await client.grant.findUnique({ where: { id: input.grantId } }) as SpendGrant | null

  if (!grant || grant.walletId !== input.walletId || grant.agentId !== input.agentId) {
    return denyGrant("GRANT_NOT_FOUND", 404, "Grant not found")
  }
  if (grant.actionType !== input.expectedActionType || grant.sourceType !== "authorization_request" || !grant.sourceId) {
    return denyGrant("GRANT_UNSUPPORTED", 403, input.unsupportedReason)
  }
  if (grant.status === "consumed") return denyGrant("GRANT_ALREADY_USED", 409, "Grant already consumed")
  if (grant.status !== "active") return denyGrant("GRANT_NOT_FOUND", 404, `Grant is ${grant.status}`)
  if (grant.expiresAt && grant.expiresAt <= now) {
    await client.grant.updateMany({ where: { id: grant.id, status: "active" }, data: { status: "expired" } })
    return denyGrant("GRANT_EXPIRED", 403, "Grant expired")
  }
  if (!input.matches(grant.resourceJson)) {
    return denyGrant("GRANT_MISMATCH", 403, input.mismatchReason)
  }

  if (input.execTokenId) {
    const exec = await client.executionToken.findUnique({ where: { id: input.execTokenId } })
    if (!exec || exec.status !== "active" || exec.expiresAt < now) {
      return denyGrant("POLICY_DENIED", 403, "Execution token expired or revoked")
    }
    if (Math.round((exec.spentUsd + input.amountUsd) * 100) > Math.round(exec.budgetUsd * 100)) {
      return denyGrant("EXEC_BUDGET_EXCEEDED", 403, "Execution budget exceeded")
    }
  }

  const consumed = await client.grant.updateMany({
    where: { id: grant.id, status: "active", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    data: { status: "consumed", consumedAt: now },
  })
  if (consumed.count === 0) return denyGrant("GRANT_ALREADY_USED", 409, "Grant already consumed")

  await reserveCascadeDailySpend(client, input.walletId, input.amountCents, now, input.ancestorChain)

  const request = await client.authorizationRequest.update({
    where: { id: grant.sourceId },
    data: { status: "approved", decidedAt: now, decisionNote: "Grant consumed" },
  })
  if (input.execTokenId) {
    await client.executionToken.update({ where: { id: input.execTokenId }, data: { spentUsd: { increment: input.amountUsd } } })
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

export function toolGrantMatches(resourceJson: unknown, request: ToolGrantRequest): boolean {
  const resource = asRecord(resourceJson)
  const approvedServer = stringValue(resource.server)
  const requestServer = stringValue(request.server)

  return resource.kind === "tool" && resource.tool === request.tool && approvedServer === requestServer
}

export function provisionGrantMatches(resourceJson: unknown, request: ProvisionGrantRequest): boolean {
  const resource = asRecord(resourceJson)
  const approvedAmount = typeof resource.amount_usd === "number" ? Math.round(resource.amount_usd * 100) : null
  const approvedDescription = stringValue(resource.description)
  const requestDescription = stringValue(request.description)

  return (
    resource.kind === "provision" &&
    resource.resource === request.resource &&
    resource.line_item === request.lineItem &&
    resource.quantity === request.quantity &&
    approvedAmount === request.amountCents &&
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
