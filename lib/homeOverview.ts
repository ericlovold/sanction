import { db } from "@/lib/db"
import { withTenant } from "@/lib/rls"
import { PROVIDERS, providerNameOf } from "@/lib/providers"
import { usageConnections } from "@/lib/usageView"
import { usageSources } from "@/lib/usageObservation"

export async function homeOverview(walletId: string, now = new Date()) {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const [keysResult, modelsResult, connectionsResult] = await Promise.allSettled([
    withTenant(walletId, tx => tx.credentialVault.findMany({
      where: { walletId, label: { startsWith: "provider:" }, revokedAt: null },
      select: { label: true },
    })),
    db.tokenLog.groupBy({
      by: ["model"],
      where: { agent: { walletId }, createdAt: { gte: monthStart, lte: now } },
      _sum: { costUsd: true },
    }),
    usageConnections(walletId, now),
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
    tools: connectionsResult.status === "fulfilled"
      ? connectionsResult.value
      : usageSources.map(source => ({ source, status: "Reporting unavailable" })),
  }
}

export type HomeOverviewData = Awaited<ReturnType<typeof homeOverview>>
