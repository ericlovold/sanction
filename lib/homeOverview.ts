import { db } from "@/lib/db"
import { withTenant } from "@/lib/rls"
import { PROVIDERS, providerNameOf, type ProviderId } from "@/lib/providers"
import { usageConnections } from "@/lib/usageView"
import { connectedTools, type ConnectionSignals } from "@/lib/connectedTools"
import { TOOL_CATALOG } from "@/lib/toolCatalog"
import { connectionHealth } from "@/lib/connectors/spendView"
import { usageProvider, type UsageProviderId } from "@/lib/connectors/registry"
import { isBilledCost } from "@/lib/connectors/facts"
import { nanosToUsd } from "@/lib/connectors/money"
import { billingProduct } from "@/lib/cursorBilling"

const settled = <T>(r: PromiseSettledResult<T>): T | null => (r.status === "fulfilled" ? r.value : null)

// Providers whose recorded spend a tool card shows (a built api_key method).
const SHOWN_PROVIDERS = new Set(
  TOOL_CATALOG.flatMap((t) => t.methods.flatMap((m) => (m.built && m.providerId ? [m.providerId] : []))),
)

// The home page shows the tools this wallet has connected, and only those.
// Every source is read independently: one failed read marks the view partial
// instead of blanking it, and never turns "unknown" into "not connected".
export async function homeOverview(walletId: string, now = new Date()) {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const [keys, models, deliveries, admin, billed, exports] = await Promise.allSettled([
    withTenant(walletId, (tx) => tx.credentialVault.findMany({
      where: { walletId, label: { startsWith: "provider:" }, revokedAt: null },
      select: { label: true },
    })),
    db.tokenLog.groupBy({
      by: ["model"],
      where: { agent: { walletId }, createdAt: { gte: monthStart, lte: now } },
      _sum: { costUsd: true },
    }),
    usageConnections(walletId, now),
    db.usageConnection.findMany({
      where: { walletId, status: { not: "disconnected" } },
      select: { provider: true, status: true, statusCode: true, lastSuccessAt: true },
    }),
    // UsageFact is FORCE RLS.
    withTenant(walletId, (tx) => tx.usageFact.groupBy({
      by: ["provider", "costBasis"],
      where: { walletId, bucketStart: { gte: monthStart, lte: now } },
      _sum: { costNanos: true },
    })),
    db.cursorBillingItem.groupBy({ by: ["product"], where: { walletId } }),
  ])

  const keyRows = settled(keys)
  const providerKeys = keyRows
    ? PROVIDERS.filter((p) => keyRows.some((k) => k.label === p.vaultLabel)).map((p) => p.id)
    : null

  const modelRows = settled(models)
  let recordedUsd: Map<ProviderId, number> | null = null
  let otherSpend: number | null = null
  if (modelRows) {
    recordedUsd = new Map()
    for (const row of modelRows) {
      if (row._sum.costUsd === null) continue
      const name = providerNameOf(row.model)
      const provider = PROVIDERS.find((p) => p.name === name)
      // Spend for a provider no tool card can show still counts somewhere.
      if (provider && SHOWN_PROVIDERS.has(provider.id)) {
        recordedUsd.set(provider.id, (recordedUsd.get(provider.id) ?? 0) + row._sum.costUsd)
      } else otherSpend = (otherSpend ?? 0) + row._sum.costUsd
    }
  }

  const billedRows = settled(billed)
  let billedUsd: Map<UsageProviderId, number> | null = null
  if (billedRows) {
    const nanos = new Map<UsageProviderId, bigint>()
    for (const row of billedRows) {
      const provider = usageProvider(row.provider)
      if (!provider || !isBilledCost(row.costBasis)) continue
      nanos.set(provider.id, (nanos.get(provider.id) ?? BigInt(0)) + (row._sum.costNanos ?? BigInt(0)))
    }
    billedUsd = new Map([...nanos].map(([id, n]) => [id, nanosToUsd(n)]))
  }

  const adminRows = settled(admin)
  const deliveryRows = settled(deliveries)
  const exportRows = settled(exports)
  const signals: ConnectionSignals = {
    providerKeys,
    adminConnections: adminRows
      ? adminRows.flatMap((c) => {
          const provider = usageProvider(c.provider)
          return provider ? [{ provider: provider.id, health: connectionHealth(c, provider.expectedFreshnessMs, now) }] : []
        })
      : null,
    collectorDeliveries: deliveryRows
      ? deliveryRows.filter((d) => d.receivedAt).map((d) => ({ source: d.source, recent: d.status === "Recently received" }))
      : null,
    billingExports: exportRows
      ? exportRows.flatMap((r) => {
          const product = billingProduct.safeParse(r.product)
          return product.success ? [product.data] : []
        })
      : null,
    recordedUsd,
    billedUsd,
  }

  return { view: connectedTools(signals), otherSpend }
}

export type HomeOverviewData = Awaited<ReturnType<typeof homeOverview>>
