import { db } from "@/lib/db"
import { authEventType, mergeEvents } from "@/lib/reporting"

// The unified audit feed (REPORT-1) as a pure lib function: spend decisions,
// token usage, and credential injections merged into one time-sorted stream —
// the "what did my agents do?" read model over the distributed audit tables.
// Shared by the header-authed REST route (/api/v1/audit-events, incl. its CSV
// export) and the cookie-authed dashboard page + export route, so all three
// read the same events. Callers own auth; this owns the read model.

export type AuditEvent = {
  type: string
  id: string
  at: string
  agent_id: string
  agent_name?: string
  pool?: string // wallet (pool) name — set only on multi-wallet (subtree) reads
  [k: string]: unknown
}

export type AuditFeed = { events: AuditEvent[]; next_before: string | null }

/** Pass an array of wallet ids (an org subtree) to read across pools — events
 *  then carry the pool name so a root owner can tell whose decision it was. */
export async function buildAuditFeed(
  walletId: string | string[],
  { type, limit, before }: { type?: string | null; limit: number; before?: Date },
): Promise<AuditFeed> {
  const multi = Array.isArray(walletId) && walletId.length > 1
  const walletWhere = Array.isArray(walletId) ? { in: walletId } : walletId
  const agents = await db.agent.findMany({
    where: { walletId: walletWhere },
    select: { id: true, name: true, wallet: { select: { name: true } } },
  })
  const agentIds = agents.map((a) => a.id)
  const nameOf = new Map(agents.map((a) => [a.id, a.name]))
  const poolOf = multi ? new Map(agents.map((a) => [a.id, a.wallet.name])) : null
  const pool = (agentId: string) => (poolOf ? { pool: poolOf.get(agentId) } : {})
  const createdAt = before ? { lt: before } : undefined

  const wantAuth = !type || type === "authorization"
  const wantToken = !type || type === "token"
  const wantInjection = !type || type === "injection"

  const [auths, tokens, injections] = await Promise.all([
    wantAuth
      ? db.authorizationRequest.findMany({ where: { agentId: { in: agentIds }, createdAt }, orderBy: { createdAt: "desc" }, take: limit })
      : [],
    wantToken
      ? db.tokenLog.findMany({ where: { agentId: { in: agentIds }, createdAt }, orderBy: { createdAt: "desc" }, take: limit })
      : [],
    wantInjection
      ? db.credentialInjection.findMany({
          where: { executionToken: { walletId: walletWhere }, injectedAt: before ? { lt: before } : undefined },
          orderBy: { injectedAt: "desc" },
          take: limit,
          include: { credential: { select: { label: true } }, executionToken: { select: { agentId: true } } },
        })
      : [],
  ])

  const events = mergeEvents<AuditEvent>(
    [
      auths.map((a): AuditEvent => ({
        type: authEventType(a.status),
        id: a.id,
        at: a.createdAt.toISOString(),
        agent_id: a.agentId,
        agent_name: nameOf.get(a.agentId),
        ...pool(a.agentId),
        action: a.action,
        amount_usd: a.amountUsd,
        merchant: a.merchant,
        category: a.category,
        status: a.status,
        reason: a.decisionNote ?? undefined,
        // Attribution tags ride detailsJson on spend rows (provision rows use
        // it for their own shape and simply won't have a tags key).
        tags: (a.detailsJson as { tags?: Record<string, string> } | null)?.tags,
      })),
      tokens.map((t): AuditEvent => ({
        type: "token.logged",
        id: t.id,
        at: t.createdAt.toISOString(),
        agent_id: t.agentId,
        agent_name: nameOf.get(t.agentId),
        ...pool(t.agentId),
        model: t.model,
        cost_usd: t.costUsd,
        tokens_in: t.tokensIn,
        tokens_out: t.tokensOut,
        task_label: t.taskLabel ?? undefined,
      })),
      injections.map((inj): AuditEvent => ({
        type: "vault.injection",
        id: inj.id,
        at: inj.injectedAt.toISOString(),
        agent_id: inj.executionToken.agentId,
        agent_name: nameOf.get(inj.executionToken.agentId),
        ...pool(inj.executionToken.agentId),
        // The joined vault row is RLS-shielded outside a tenant transaction, so
        // Prisma can hand back null here despite the required relation — the
        // injection row itself must still render (it's the audit record).
        credential_label: inj.credential?.label,
        execution_token_id: inj.executionTokenId,
      })),
    ],
    limit,
  )

  const nextBefore = events.length === limit ? events[events.length - 1].at : null
  return { events, next_before: nextBefore }
}
