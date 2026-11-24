import { db } from "@/lib/db"
import { withTenant } from "@/lib/rls"
import { PROVIDERS, providerNameOf } from "@/lib/providers"
import { usageView } from "@/lib/usageView"
import { usageSources } from "@/lib/usageObservation"

type UsageView = Awaited<ReturnType<typeof usageView>>

/** Observation estimates stay separate from recorded model spending. */
export function summarizeHomeTools(usage: UsageView | null) {
  return usageSources.map(source => {
    const connection = usage?.connections.find(c => c.source === source)
    const sessions = usage?.sessions.filter(s => s.source === source) ?? []
    const calls = sessions.reduce((sum, s) => sum + s.modelCalls, 0)
    const unpriced = sessions.reduce((sum, s) => sum + s.unpricedCalls, 0)
    const unmetered = sessions.reduce((sum, s) => sum + s.unmeteredCalls, 0)
    return {
      source,
      status: usage ? connection?.status ?? "No events received" : "Reporting unavailable",
      receivedAt: connection?.receivedAt ?? null,
      sessions: usage && sessions.length ? sessions.length : null,
      calls: calls || null,
      tokens: calls > unmetered ? sessions.reduce((sum, s) => sum + s.tokensIn + s.tokensOut, 0) : null,
      estimatedCost: calls > unpriced ? sessions.reduce((sum, s) => sum + s.estimatedCost, 0) : null,
      tokensPartial: Boolean(usage?.truncated || unmetered),
      estimatePartial: Boolean(usage?.truncated || unpriced),
      truncated: Boolean(usage?.truncated),
    }
  })
}

export async function homeOverview(walletId: string, now = new Date()) {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const [keysResult, modelsResult, usageResult] = await Promise.allSettled([
    withTenant(walletId, tx => tx.credentialVault.findMany({
      where: { walletId, label: { startsWith: "provider:" }, revokedAt: null },
      select: { label: true },
    })),
    db.tokenLog.groupBy({
      by: ["model"],
      where: { agent: { walletId }, createdAt: { gte: monthStart, lte: now } },
      _sum: { costUsd: true },
    }),
    usageView(walletId, now),
  ])
  const labels = keysResult.status === "fulfilled" ? new Set(keysResult.value.map(k => k.label)) : null
  const models = modelsResult.status === "fulfilled" ? modelsResult.value : null
  const spend = new Map<string, number>()
  for (const row of models ?? []) {
    if (row._sum.costUsd !== null) {
      const provider = providerNameOf(row.model)
      spend.set(provider, (spend.get(provider) ?? 0) + row._sum.costUsd)
    }
  }
  return {
    providers: PROVIDERS.map(provider => ({
      id: provider.id,
      name: provider.name,
      keyStatus: labels === null ? "Key status unavailable" : labels.has(provider.vaultLabel) ? "Key stored" : "No stored key",
      spend: spend.get(provider.name) ?? null,
    })),
    otherSpend: spend.get("Other") ?? null,
    spendUnavailable: models === null,
    tools: summarizeHomeTools(usageResult.status === "fulfilled" ? usageResult.value : null),
  }
}

export type HomeOverviewData = Awaited<ReturnType<typeof homeOverview>>
