import { NextRequest, NextResponse } from "next/server"
import { createHash, timingSafeEqual } from "crypto"
import { db } from "@/lib/db"
import { deliverEvent } from "@/lib/webhooks"
import { dayRangeUtc } from "@/lib/reporting"

// Weekly digest (REPORT-2): Vercel Cron fires Monday 14:00 UTC (vercel.json)
// and every wallet with a route subscribed to `report.weekly_digest` (or "*")
// gets last week's rollup pushed to wherever its humans are — Slack gets the
// formatted card, machine endpoints get the signed JSON. The digest is the
// summary endpoint's aggregations pointed at the 7 completed UTC days before
// today, plus the 7 before those for week-over-week.

// Vercel sends `Authorization: Bearer ${CRON_SECRET}` when the env var is set.
// Unset secret ⇒ fail closed: nobody can trigger a digest run.
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const given = createHash("sha256").update(req.headers.get("authorization") ?? "").digest()
  const want = createHash("sha256").update(`Bearer ${secret}`).digest()
  return timingSafeEqual(given, want)
}

async function walletDigest(walletId: string, start: Date, end: Date, prevStart: Date) {
  const agents = await db.agent.findMany({ where: { walletId }, select: { id: true, name: true } })
  const agentIds = agents.map((a) => a.id)
  const nameOf = new Map(agents.map((a) => [a.id, a.name]))
  const inRange = { gte: start, lt: end }
  const prevRange = { gte: prevStart, lt: start }

  const [spend, decisions, tokens, injections, prevSpend, prevTokens, perAgentSpend, perAgentTokens] = await Promise.all([
    db.authorizationRequest.aggregate({ where: { agentId: { in: agentIds }, status: "approved", createdAt: inRange }, _sum: { amountUsd: true } }),
    db.authorizationRequest.groupBy({ by: ["status"], where: { agentId: { in: agentIds }, createdAt: inRange }, _count: { _all: true } }),
    db.tokenLog.aggregate({ where: { agentId: { in: agentIds }, createdAt: inRange }, _sum: { costUsd: true, tokensIn: true, tokensOut: true } }),
    db.credentialInjection.count({ where: { executionToken: { walletId }, injectedAt: inRange } }),
    db.authorizationRequest.aggregate({ where: { agentId: { in: agentIds }, status: "approved", createdAt: prevRange }, _sum: { amountUsd: true } }),
    db.tokenLog.aggregate({ where: { agentId: { in: agentIds }, createdAt: prevRange }, _sum: { costUsd: true } }),
    db.authorizationRequest.groupBy({ by: ["agentId"], where: { agentId: { in: agentIds }, status: "approved", createdAt: inRange }, _sum: { amountUsd: true } }),
    db.tokenLog.groupBy({ by: ["agentId"], where: { agentId: { in: agentIds }, createdAt: inRange }, _sum: { costUsd: true } }),
  ])

  const counts: Record<string, number> = { approved: 0, denied: 0, escalated: 0 }
  for (const d of decisions) if (d.status in counts) counts[d.status] = d._count._all

  // Busiest agent by combined spend + token cost — the seat the week was about.
  const combined = new Map<string, number>()
  for (const r of perAgentSpend) combined.set(r.agentId, (combined.get(r.agentId) ?? 0) + (r._sum.amountUsd ?? 0))
  for (const r of perAgentTokens) combined.set(r.agentId, (combined.get(r.agentId) ?? 0) + (r._sum.costUsd ?? 0))
  const top = [...combined.entries()].sort((a, b) => b[1] - a[1])[0]

  return {
    spend_usd: spend._sum.amountUsd ?? 0,
    token_cost_usd: tokens._sum.costUsd ?? 0,
    tokens_in: tokens._sum.tokensIn ?? 0,
    tokens_out: tokens._sum.tokensOut ?? 0,
    approved: counts.approved,
    denied: counts.denied,
    escalated: counts.escalated,
    secret_accesses: injections,
    prev_spend_usd: prevSpend._sum.amountUsd ?? 0,
    prev_token_cost_usd: prevTokens._sum.costUsd ?? 0,
    ...(top && top[1] > 0 ? { top_agent: nameOf.get(top[0]), top_agent_usd: Math.round(top[1] * 100) / 100 } : {}),
  }
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // [start, end) = the 7 completed UTC days before today; the week before that
  // is the comparison window.
  const end = dayRangeUtc(new Date().toISOString().slice(0, 10)).start
  const start = new Date(end.getTime() - 7 * 86_400_000)
  const prevStart = new Date(start.getTime() - 7 * 86_400_000)

  const hooks = await db.webhook.findMany({
    where: { isActive: true, events: { hasSome: ["report.weekly_digest", "*"] } },
    select: { walletId: true },
  })
  const walletIds = [...new Set(hooks.map((h) => h.walletId))]

  // Sequential on purpose (a handful of wallets, eight queries each), and one
  // wallet's failure must not starve the rest of their digest.
  let delivered = 0
  let failed = 0
  for (const walletId of walletIds) {
    try {
      const digest = await walletDigest(walletId, start, end, prevStart)
      await deliverEvent(walletId, "report.weekly_digest", {
        period_start: start.toISOString().slice(0, 10),
        period_end: new Date(end.getTime() - 86_400_000).toISOString().slice(0, 10),
        ...digest,
      })
      delivered++
    } catch (err) {
      // Unattended weekly run — a silent count would hide a broken wallet forever.
      console.error(`weekly digest failed for wallet ${walletId}`, err)
      failed++
    }
  }

  return NextResponse.json({ wallets: walletIds.length, delivered, failed }, { headers: { "Cache-Control": "no-store" } })
}
