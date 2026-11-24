import Link from "next/link"
import { db } from "@/lib/db"
import { getSessionMember } from "@/lib/session"
import { hasRole } from "@/lib/roles"
import { cursorDay } from "@/lib/connectors/cursorSources"
import { incidentDetail } from "./incident-detail"
import { getDailyUsage } from "./daily-usage"
import { DailyTable } from "./daily-table"
import { CursorImportForm } from "./import-form"

export const dynamic = "force-dynamic"
export const metadata = { title: "Cursor billing export | Sanction" }

function reported(value: string | number | null, known: number, total: number) {
  if (value === null) return "Unavailable"
  const formatted = typeof value === "number" ? value.toLocaleString("en-US") : value
  return known === total ? formatted : `${formatted} (partial)`
}

export default async function CursorUsagePage({ searchParams }: { searchParams?: Promise<{ day?: string | string[] }> } = {}) {
  const day = (await searchParams)?.day
  const start = day === undefined ? null : cursorDay(day)
  const member = await getSessionMember()
  if (!member) {
    const next = start ? `/dashboard/usage/cursor?day=${start.toISOString().slice(0, 10)}#incident` : "/dashboard/usage/cursor"
    return <Link href={`/login?next=${encodeURIComponent(next)}`}>Sign in to view Cursor billing items</Link>
  }
  const { wallet } = member
  if (day !== undefined) {
    if (!start) return <div className="p-5"><h1 className="text-2xl font-semibold">Invalid Cursor usage date</h1><Link href="/dashboard/usage/cursor" className="underline">View imported days</Link></div>
    return incidentDetail(wallet.id, wallet.name, start, hasRole(member.role, "admin"))
  }
  const [days, groups] = await Promise.all([getDailyUsage(wallet.id), db.cursorBillingItem.groupBy({
    where: { walletId: wallet.id }, by: ["product", "chargeCategory", "usageType", "currency"],
    orderBy: [{ product: "asc" }, { chargeCategory: "asc" }, { usageType: "asc" }, { currency: "asc" }],
    _min: { occurredAt: true }, _max: { occurredAt: true },
    _count: { _all: true, promptTokens: true, completionTokens: true, cachedPromptTokens: true, cacheWriteTokens: true, contracted: true },
    _sum: { promptTokens: true, completionTokens: true, cachedPromptTokens: true, cacheWriteTokens: true, contracted: true },
  })])
  return <div className="mx-auto max-w-7xl space-y-6 p-5 md:p-10">
    <Link className="text-sm underline" href="/dashboard/usage">Developer usage</Link>
    <h1 className="text-3xl font-semibold">Cursor billing export</h1>
    <p className="text-sm text-muted-foreground">Provider-reported billing items imported into {wallet.name}. These amounts are separate from governed spend and budgets.</p>
    {hasRole(member.role, "admin") && <CursorImportForm walletId={wallet.id} walletName={wallet.name} />}
    {days.length > 0 && <DailyTable days={days} />}
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
