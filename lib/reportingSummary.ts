import { db } from "@/lib/db"

// Period reporting (REPORT-1) as a pure lib function, so both the header-authed
// REST route (/api/v1/reporting/summary) and the cookie-authed dashboard page
// run the SAME 8 queries and can't drift. Callers own auth and range parsing;
// this owns the read model. Returns a typed shape (not the route's JSON body) so
// the dashboard consumes lib types, not a route-response contract.

export type PeriodSummaryDay = {
  date: string
  spend_usd: number
  approved: number
  denied: number
  escalated: number
  token_cost_usd: number
}

export type PeriodSummaryAgent = {
  agent_id: string
  agent_name: string | undefined
  pool?: string // wallet (pool) name — set only on multi-wallet (subtree) reads
  spend_usd: number
  approved: number
  denied: number
  escalated: number
  token_cost_usd: number
}

export type PeriodSummary = {
  totals: {
    spend_usd: number
    decisions: Record<string, number>
    token_cost_usd: number
    tokens_in: number
    tokens_out: number
    secret_accesses: number
  }
  days: PeriodSummaryDay[]
  by_agent?: PeriodSummaryAgent[]
}

/** Pass an array of wallet ids (an org subtree) to aggregate across pools —
 *  per-agent rows then carry the pool name for the org-level rollup. */
export async function buildPeriodSummary(
  walletId: string | string[],
  { start, end, groupByAgent = false }: { start: Date; end: Date; groupByAgent?: boolean },
): Promise<PeriodSummary> {
  const multi = Array.isArray(walletId) && walletId.length > 1
  const walletWhere = Array.isArray(walletId) ? { in: walletId } : walletId
  const agents = await db.agent.findMany({
    where: { walletId: walletWhere },
    select: { id: true, name: true, wallet: { select: { name: true } } },
  })
  const agentIds = agents.map((a) => a.id)
  const nameOf = new Map(agents.map((a) => [a.id, a.name]))
  const poolOf = multi ? new Map(agents.map((a) => [a.id, a.wallet.name])) : null
  const inRange = { gte: start, lt: end }

  const [approved, decisions, tokenAgg, injections, spendDays, tokenDays, perAgentSpend, perAgentTokens] = await Promise.all([
    db.authorizationRequest.aggregate({ where: { agentId: { in: agentIds }, status: "approved", createdAt: inRange }, _sum: { amountUsd: true } }),
    db.authorizationRequest.groupBy({ by: ["status"], where: { agentId: { in: agentIds }, createdAt: inRange }, _count: { _all: true } }),
    db.tokenLog.aggregate({ where: { agentId: { in: agentIds }, createdAt: inRange }, _sum: { costUsd: true, tokensIn: true, tokensOut: true } }),
    db.credentialInjection.count({ where: { executionToken: { walletId: walletWhere }, injectedAt: inRange } }),
    // Day buckets via date_trunc — one round-trip per table, not per day.
    agentIds.length > 0
      ? db.$queryRaw<Array<{ day: Date; spend: number | null; approved: bigint; denied: bigint; escalated: bigint }>>`
          SELECT date_trunc('day', "createdAt" AT TIME ZONE 'UTC') AS day,
                 SUM("amountUsd") FILTER (WHERE status = 'approved') AS spend,
                 COUNT(*) FILTER (WHERE status = 'approved') AS approved,
                 COUNT(*) FILTER (WHERE status = 'denied') AS denied,
                 COUNT(*) FILTER (WHERE status = 'escalated') AS escalated
          FROM "AuthorizationRequest"
          WHERE "agentId" = ANY(${agentIds}) AND "createdAt" >= ${start} AND "createdAt" < ${end}
          GROUP BY 1 ORDER BY 1`
      : [],
    agentIds.length > 0
      ? db.$queryRaw<Array<{ day: Date; cost: number | null }>>`
          SELECT date_trunc('day', "createdAt" AT TIME ZONE 'UTC') AS day, SUM("costUsd") AS cost
          FROM "TokenLog"
          WHERE "agentId" = ANY(${agentIds}) AND "createdAt" >= ${start} AND "createdAt" < ${end}
          GROUP BY 1 ORDER BY 1`
      : [],
    groupByAgent
      ? db.authorizationRequest.groupBy({ by: ["agentId", "status"], where: { agentId: { in: agentIds }, createdAt: inRange }, _sum: { amountUsd: true }, _count: { _all: true } })
      : [],
    groupByAgent
      ? db.tokenLog.groupBy({ by: ["agentId"], where: { agentId: { in: agentIds }, createdAt: inRange }, _sum: { costUsd: true } })
      : [],
  ])

  const decisionCounts: Record<string, number> = { approved: 0, denied: 0, escalated: 0, pending: 0 }
  for (const d of decisions) decisionCounts[d.status] = d._count._all

  const tokenByDay = new Map(tokenDays.map((t) => [t.day.toISOString().slice(0, 10), t.cost ?? 0]))
  const dayKeys = new Set<string>([...spendDays.map((d) => d.day.toISOString().slice(0, 10)), ...tokenByDay.keys()])
  const spendByDay = new Map(spendDays.map((d) => [d.day.toISOString().slice(0, 10), d]))
  const days: PeriodSummaryDay[] = [...dayKeys].sort().map((key) => {
    const s = spendByDay.get(key)
    return {
      date: key,
      spend_usd: s?.spend ?? 0,
      approved: Number(s?.approved ?? 0),
      denied: Number(s?.denied ?? 0),
      escalated: Number(s?.escalated ?? 0),
      token_cost_usd: tokenByDay.get(key) ?? 0,
    }
  })

  let byAgent: PeriodSummaryAgent[] | undefined
  if (groupByAgent) {
    const rows = new Map<string, { spend_usd: number; approved: number; denied: number; escalated: number; token_cost_usd: number }>()
    const blank = () => ({ spend_usd: 0, approved: 0, denied: 0, escalated: 0, token_cost_usd: 0 })
    // Every agent appears, zeroed if idle — "which seats did nothing this
    // period" is a signal, not an omission.
    for (const id of agentIds) rows.set(id, blank())
    for (const r of perAgentSpend) {
      const row = rows.get(r.agentId) ?? blank()
      if (r.status === "approved") row.spend_usd += r._sum.amountUsd ?? 0
      if (r.status === "approved") row.approved += r._count._all
      if (r.status === "denied") row.denied += r._count._all
      if (r.status === "escalated") row.escalated += r._count._all
      rows.set(r.agentId, row)
    }
    for (const t of perAgentTokens) {
      const row = rows.get(t.agentId) ?? blank()
      row.token_cost_usd += t._sum.costUsd ?? 0
      rows.set(t.agentId, row)
    }
    byAgent = [...rows.entries()]
      .map(([agentId, r]) => ({
        agent_id: agentId,
        agent_name: nameOf.get(agentId),
        ...(poolOf ? { pool: poolOf.get(agentId) } : {}),
        ...r,
      }))
      .sort((a, b) => b.spend_usd + b.token_cost_usd - (a.spend_usd + a.token_cost_usd))
  }

  return {
    totals: {
      spend_usd: approved._sum.amountUsd ?? 0,
      decisions: decisionCounts,
      token_cost_usd: tokenAgg._sum.costUsd ?? 0,
      tokens_in: tokenAgg._sum.tokensIn ?? 0,
      tokens_out: tokenAgg._sum.tokensOut ?? 0,
      secret_accesses: injections,
    },
    days,
    ...(byAgent ? { by_agent: byAgent } : {}),
  }
}
