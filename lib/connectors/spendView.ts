// Read model for the AI spend page. Every figure here comes from UsageFact,
// which is under FORCE RLS: all reads go through withTenant, so even a wrong
// walletId in a where clause cannot return another wallet's usage.

import { db } from "@/lib/db"
import { withTenant } from "@/lib/rls"
import { DAY_MS, needsReconnect } from "./facts"
import type { AlertEvidence } from "./guardrails"
import { KEY_AGE_WARNING_DAYS, usageProvider } from "./registry"

const ZERO = BigInt(0)
const CHART_DAYS = 30

export type ConnectionHealth = "ok" | "waiting" | "stale" | "failing" | "reconnect"

function monthStartUtc(d: Date, offset = 0): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1))
}

/**
 * Straight-line run rate: month to date divided by the share of the month
 * that has passed. Null in the first three days, when one busy afternoon
 * would project to an absurd month.
 */
export function forecastMonthEnd(monthToDate: bigint, now: Date): bigint | null {
  const start = monthStartUtc(now).getTime()
  const end = monthStartUtc(now, 1).getTime()
  const elapsed = now.getTime() - start
  if (elapsed < 3 * DAY_MS) return null
  return (monthToDate * BigInt(end - start)) / BigInt(elapsed)
}

export function connectionHealth(
  c: { status: string; statusCode: string | null; lastSuccessAt: Date | null },
  expectedFreshnessMs: number,
  now: Date,
): ConnectionHealth {
  if (needsReconnect(c.statusCode)) return "reconnect"
  if (!c.lastSuccessAt) return c.status === "error" ? "failing" : "waiting"
  // The epic's "connection stale" rule: no successful pull in twice the
  // provider's expected freshness.
  if (now.getTime() - c.lastSuccessAt.getTime() > 2 * expectedFreshnessMs) return c.status === "error" ? "failing" : "stale"
  return "ok"
}

export async function aiSpendView(walletId: string, now = new Date()) {
  const monthStart = monthStartUtc(now)
  const lastMonthStart = monthStartUtc(now, -1)
  const chartStart = new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS - (CHART_DAYS - 1) * DAY_MS)
  const from = chartStart < lastMonthStart ? chartStart : lastMonthStart

  const connections = await db.usageConnection.findMany({
    where: { walletId, status: { not: "disconnected" } },
    orderBy: { connectedAt: "asc" },
  })

  const { hourly, people, alerts, runs, refreshed } = await withTenant(walletId, async (tx) => ({
    // How current each connection's data is by the provider's own account
    // (Anthropic states it; for Cursor it is our pull time).
    refreshed: await tx.usageFact.groupBy({ by: ["connectionId"], where: { walletId }, _max: { sourceRefreshedAt: true } }),
    // Hour x provider x basis is small (30 days is 720 hours a provider) and
    // folds into days, months and the split in one pass.
    hourly: await tx.usageFact.groupBy({
      by: ["bucketStart", "provider", "costBasis"],
      where: { walletId, bucketStart: { gte: from } },
      _sum: { costNanos: true },
    }),
    people: await tx.usageFact.groupBy({
      by: ["provider", "rawIdentity", "identityType", "model", "costBasis"],
      where: { walletId, bucketStart: { gte: monthStart } },
      _sum: { costNanos: true, inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheWriteTokens: true, requests: true },
    }),
    alerts: await tx.usageAlert.findMany({ where: { walletId }, orderBy: { createdAt: "desc" }, take: 20 }),
    runs: await tx.usageSyncRun.findMany({ where: { walletId }, orderBy: { startedAt: "desc" }, take: 10 }),
  }))

  let monthToDate = ZERO
  let monthBilled = ZERO
  let monthEstimated = ZERO
  let lastMonth = ZERO
  const days = Array.from({ length: CHART_DAYS }, (_, i) => ({
    date: new Date(chartStart.getTime() + i * DAY_MS),
    byProvider: new Map<string, bigint>(),
    total: ZERO,
  }))
  const monthByProvider = new Map<string, bigint>()
  for (const row of hourly) {
    const cost = row._sum.costNanos ?? ZERO
    const t = row.bucketStart.getTime()
    if (t >= monthStart.getTime()) {
      monthToDate += cost
      if (row.costBasis === "billed") monthBilled += cost
      if (row.costBasis === "estimated") monthEstimated += cost
      monthByProvider.set(row.provider, (monthByProvider.get(row.provider) ?? ZERO) + cost)
    } else if (t >= lastMonthStart.getTime()) {
      lastMonth += cost
    }
    const day = days[Math.floor((t - chartStart.getTime()) / DAY_MS)]
    if (day && t >= chartStart.getTime()) {
      day.byProvider.set(row.provider, (day.byProvider.get(row.provider) ?? ZERO) + cost)
      day.total += cost
    }
  }

  // One row per identity across every tool. The same email on two tools is
  // the same person; ids that only one provider knows (an OpenAI user id, an
  // API key) stay their own row until someone maps them.
  type Person = { identity: string; identityType: string; cost: bigint; billed: bigint; tokens: bigint; requests: number; topModel: string; tools: [string, bigint][] }
  const byPerson = new Map<string, Person>()
  const byModel = new Map<string, bigint>()
  const personModel = new Map<string, Map<string, bigint>>()
  const personTools = new Map<string, Map<string, bigint>>()
  const bump = (outer: Map<string, Map<string, bigint>>, who: string, key: string, cost: bigint) => {
    const inner = outer.get(who) ?? new Map<string, bigint>()
    inner.set(key, (inner.get(key) ?? ZERO) + cost)
    outer.set(who, inner)
  }
  for (const row of people) {
    const cost = row._sum.costNanos ?? ZERO
    const who = row.rawIdentity
    const p = byPerson.get(who) ?? { identity: who, identityType: row.identityType, cost: ZERO, billed: ZERO, tokens: ZERO, requests: 0, topModel: row.model, tools: [] }
    p.cost += cost
    if (row.costBasis === "billed") p.billed += cost
    p.tokens += (row._sum.inputTokens ?? ZERO) + (row._sum.outputTokens ?? ZERO) + (row._sum.cacheReadTokens ?? ZERO) + (row._sum.cacheWriteTokens ?? ZERO)
    p.requests += row._sum.requests ?? 0
    byPerson.set(who, p)
    bump(personModel, who, row.model, cost)
    bump(personTools, who, row.provider, cost)
    const modelKey = JSON.stringify([row.provider, row.model])
    byModel.set(modelKey, (byModel.get(modelKey) ?? ZERO) + cost)
  }
  const byCostDesc = (a: [string, bigint], b: [string, bigint]) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : a[0].localeCompare(b[0]))
  for (const [who, p] of byPerson) {
    p.topModel = [...personModel.get(who)!.entries()].sort(byCostDesc)[0][0]
    p.tools = [...personTools.get(who)!.entries()].sort(byCostDesc)
  }
  const desc = <T,>(of: (x: T) => bigint) => (a: T, b: T) => (of(a) < of(b) ? 1 : of(a) > of(b) ? -1 : 0)

  return {
    hasData: hourly.length > 0,
    monthStart,
    monthToDate,
    monthBilled,
    // Not billed yet: a provider that prices by the day has not priced it.
    monthEstimated,
    lastMonth,
    // Last month is only whole if a connection was pulling before it began.
    lastMonthPartial: !connections.some((c) => c.connectedAt.getTime() - 30 * DAY_MS <= lastMonthStart.getTime()),
    forecast: forecastMonthEnd(monthToDate, now),
    monthByProvider: [...monthByProvider.entries()].sort(desc((e) => e[1])),
    days,
    people: [...byPerson.values()].sort(desc((p) => p.cost)),
    models: [...byModel.entries()]
      .map(([key, cost]) => ({ provider: (JSON.parse(key) as string[])[0], model: (JSON.parse(key) as string[])[1], cost }))
      .sort(desc((m) => m.cost))
      .slice(0, 5),
    alerts: alerts.map((a) => ({ ...a, evidence: a.evidence as unknown as AlertEvidence })),
    connections: connections.map((c) => {
      const provider = usageProvider(c.provider)
      return {
        id: c.id,
        provider: c.provider,
        connectedAt: c.connectedAt,
        connectedByEmail: c.connectedByEmail,
        lastSuccessAt: c.lastSuccessAt,
        // "Data as of": the provider's refresh time when it reports one that
        // is older than our last pull, never newer than what we hold.
        dataAsOf: refreshed.find((r) => r.connectionId === c.id)?._max.sourceRefreshedAt ?? c.lastSuccessAt,
        lastAttemptAt: c.lastAttemptAt,
        statusDetail: c.statusDetail,
        health: connectionHealth(c, provider?.expectedFreshnessMs ?? 3_600_000, now),
        keyAgeDays: Math.floor((now.getTime() - c.connectedAt.getTime()) / DAY_MS),
        keyIsOld: now.getTime() - c.connectedAt.getTime() > KEY_AGE_WARNING_DAYS * DAY_MS,
        lastRun: runs.find((r) => r.connectionId === c.id) ?? null,
      }
    }),
  }
}

export type AiSpendView = Awaited<ReturnType<typeof aiSpendView>>
