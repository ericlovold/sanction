import { db } from "./db"
import { usageSources, type UsageSource } from "./usageObservation"

export async function usageView(walletId: string, now = new Date()) {
  const since = new Date(now.getTime() - 7 * 86_400_000)
  const [latest, rows] = await Promise.all([
    db.usageObservation.groupBy({
      by: ["source"], where: { agent: { walletId } },
      _max: { receivedAt: true, occurredAt: true },
    }),
    db.usageObservation.findMany({
      where: { agent: { walletId }, occurredAt: { gte: since, lte: now } },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 1001,
      include: { agent: { select: { name: true } } },
    }),
  ])
  const sessions = new Map<string, {
    key: string; sessionId: string; source: string; seat: string; lastEvent: Date;
    events: number; modelCalls: number; tokensIn: number; tokensOut: number;
    estimatedCost: number; unpricedCalls: number; unmeteredCalls: number;
  }>()
  for (const row of rows.slice(0, 1000)) {
    const key = JSON.stringify([row.agentId, row.source, row.sessionId])
    const item = sessions.get(key) ?? { key, sessionId: row.sessionId, source: row.source, seat: row.agent.name,
      lastEvent: row.occurredAt, events: 0, modelCalls: 0, tokensIn: 0, tokensOut: 0, estimatedCost: 0, unpricedCalls: 0, unmeteredCalls: 0 }
    item.events++
    if (row.eventName === "model_usage") {
      item.modelCalls++
      if (row.tokensIn === null || row.tokensOut === null) item.unmeteredCalls++
      item.tokensIn += row.tokensIn ?? 0
      item.tokensOut += row.tokensOut ?? 0
      item.estimatedCost += row.estimatedCostUsd ?? 0
      if (row.estimatedCostUsd === null) item.unpricedCalls++
    }
    sessions.set(key, item)
  }
  return {
    truncated: rows.length > 1000, sessions: [...sessions.values()],
    connections: usageSources.map(source => {
      const last = latest.find(r => r.source === source)?._max
      const receivedAt = last?.receivedAt ?? null, occurredAt = last?.occurredAt ?? null
      return { source: source as UsageSource, receivedAt, occurredAt,
        status: !receivedAt ? "No events received" : now.getTime() - receivedAt.getTime() > 15 * 60_000 ? "No recent delivery" : "Recently received" }
    }),
  }
}
