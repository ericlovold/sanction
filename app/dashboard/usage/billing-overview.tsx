import Link from "next/link"
import { db } from "@/lib/db"
import { billingProductNames, type BillingProduct } from "@/lib/cursorBilling"
import { getDailyUsage } from "./cursor/daily-usage"
import { DailyTable } from "./cursor/daily-table"
import { BillingImportForm } from "./cursor/import-form"

function reported(value: string | number | null, known: number, total: number) {
  if (value === null) return "Unavailable"
  const formatted = typeof value === "number" ? value.toLocaleString("en-US") : value
  return known === total ? formatted : `${formatted} (partial)`
}

export async function billingOverview(wallet: { id: string; name: string }, canImport: boolean, product: BillingProduct) {
  const [days, groups] = await Promise.all([getDailyUsage(wallet.id, product), db.cursorBillingItem.groupBy({
    where: { walletId: wallet.id, product }, by: ["product", "chargeCategory", "usageType", "currency"],
    orderBy: [{ product: "asc" }, { chargeCategory: "asc" }, { usageType: "asc" }, { currency: "asc" }],
    _min: { occurredAt: true }, _max: { occurredAt: true },
    _count: { _all: true, promptTokens: true, completionTokens: true, cachedPromptTokens: true, cacheWriteTokens: true, contracted: true },
    _sum: { promptTokens: true, completionTokens: true, cachedPromptTokens: true, cacheWriteTokens: true, contracted: true },
  })])
  return <div className="mx-auto max-w-7xl space-y-6 p-5 md:p-10">
    <Link className="text-sm underline" href="/dashboard/usage">Developer usage</Link>
    <h1 className="text-3xl font-semibold">{billingProductNames[product]} billing export</h1>
    <p className="text-sm text-muted-foreground">Provider-reported billing items imported into {wallet.name}. These amounts are separate from governed spend and budgets.</p>
    {canImport && <BillingImportForm product={product} walletId={wallet.id} walletName={wallet.name} />}
    {days.length > 0 && <DailyTable days={days} isCursor={product === "cursor"} />}
    <h2 className="text-xl font-medium">All imported billing items</h2>
    {!groups.length ? <p>No billing items imported.</p> : <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-left text-sm">
        <thead className="border-b"><tr>{["Product / category", "Usage type", "Period (UTC)", "Items", "Prompt tokens", "Completion tokens", "Cached prompt tokens", "Cache-write tokens", "Contracted price"].map(label => <th className="p-3" key={label}>{label}</th>)}</tr></thead>
        <tbody>{groups.map(group => <tr className="border-b last:border-0" key={JSON.stringify([group.product, group.chargeCategory, group.usageType, group.currency])}>
          <td className="p-3">{group.product} / {group.chargeCategory}</td><td className="p-3">{group.usageType}</td>
          <td className="p-3">{group._min.occurredAt?.toISOString().slice(0, 10)} – {group._max.occurredAt?.toISOString().slice(0, 10)}</td>
          <td className="p-3">{group._count._all.toLocaleString("en-US")}</td>
          {(["promptTokens", "completionTokens", "cachedPromptTokens", "cacheWriteTokens"] as const).map(unit =>
            <td className="p-3" key={unit}>{reported(group._sum[unit], group._count[unit], group._count._all)}</td>)}
          <td className="p-3">{group.currency} {reported(group._sum.contracted?.toFixed() ?? null, group._count.contracted, group._count._all)}</td>
        </tr>)}</tbody>
      </table>
    </div>}
  </div>
}
