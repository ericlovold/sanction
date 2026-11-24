import Link from "next/link"
import { db } from "@/lib/db"
import { cursorSources } from "@/lib/connectors/cursorSources"
import { CURSOR_DAILY_TOKENS, CURSOR_DAILY_EVENTS } from "@/lib/connectors/cursorVolume"
import type { Prisma } from "@/lib/generated/prisma/client"
import { DAY_MS } from "@/lib/connectors/facts"
import { getDailyUsage } from "./daily-usage"

function count(value: bigint | null, partial: boolean) {
  if (value === null) return "Unreported"
  return value.toLocaleString("en-US") + (partial ? " (partial)" : "")
}

function price(amount: Prisma.Decimal, currency: string | null) {
  const exact = amount.toFixed()
  const shown = amount.abs().gt(0) && amount.abs().lt("0.01") ? exact : amount.toFixed(2)
  return <span title={`${currency} ${exact}`}>{currency === "USD" ? "$" : `${currency} `}{shown}</span>
}

export async function incidentDetail(walletId: string, walletName: string, start: Date, canReadSources: boolean) {
  const day = start.toISOString().slice(0, 10)
  const window = { gte: start, lt: new Date(start.getTime() + DAY_MS) }
  const [[usage], charges, sources] = await Promise.all([
    getDailyUsage(walletId, "cursor", window),
    db.cursorBillingItem.groupBy({
      by: ["usageType", "currency"], where: { walletId, product: "cursor", occurredAt: window },
      _sum: { contracted: true }, _count: { _all: true, contracted: true }, _max: { occurredAt: true },
      orderBy: [{ usageType: "asc" }, { currency: "asc" }],
    }),
    canReadSources ? cursorSources(walletId, start) : null,
  ])
  const identified = sources?.rows.filter(row => row.id) ?? []
  const lastEvent = charges.reduce<Date | null>((latest, group) => {
    const date = group._max.occurredAt
    return date && (!latest || date > latest) ? date : latest
  }, null)
  const share = usage?.tokens && usage.cached !== null
    ? (100 * Number(usage.cached) / Number(usage.tokens)).toFixed(1) + "%"
    : null
  const thresholds = []
  if (usage?.tokens != null && usage.tokens >= CURSOR_DAILY_TOKENS) thresholds.push(`${CURSOR_DAILY_TOKENS.toLocaleString("en-US")} reported tokens`)
  if (usage && usage.items >= CURSOR_DAILY_EVENTS) thresholds.push(`${CURSOR_DAILY_EVENTS.toLocaleString("en-US")} billing items`)
  return <div id="incident" className="mx-auto max-w-4xl space-y-7 p-5 md:p-10">
    <nav aria-label="Cursor usage navigation" className="flex gap-4 text-sm underline underline-offset-4">
      <Link href="/dashboard">Home</Link><Link href="/dashboard/usage/cursor">All imported days</Link>
    </nav>
    <header className="space-y-1">
      <h1 className="text-3xl font-semibold">Cursor usage · {day} UTC</h1>
      <p className="text-sm text-muted-foreground">Personal billing export for {walletName}.{lastEvent && ` Latest imported event this day at ${lastEvent.toISOString().slice(11, 19)} UTC.`}</p>
      {thresholds.length > 0 && <p className="font-medium text-amber-800 dark:text-amber-300">High volume · Reached the daily threshold for {thresholds.join(" and ")}.</p>}
    </header>
    {usage ? <>
      <dl className="grid grid-cols-2 gap-4 rounded-lg border bg-card p-4 sm:grid-cols-4">
        {[
          ["Billing items", count(usage.items, false)], ["Reported tokens", count(usage.tokens, usage.partial)],
          ["Cached prompt tokens", count(usage.cached, usage.cachedPartial)],
          ["Cached share", share ? share + (usage.partial ? " (partial)" : "") : "Unreported"],
        ].map(([label, value]) => <div key={label}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="font-semibold tabular-nums">{value}</dd></div>)}
      </dl>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Charges reported by Cursor</h2>
        {charges.map(group => <p key={JSON.stringify([group.usageType, group.currency])}>
          {group.usageType.replaceAll("_", " ")} · {group._count._all.toLocaleString("en-US")} billing items · {group._sum.contracted === null ? "Price unreported" :
            <>{price(group._sum.contracted, group.currency)}{group._count.contracted < group._count._all ? " (partial)" : ""}</>}
        </p>)}
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Model breakdown</h2>
        {usage.models.every(row => row.model === null) ? <p>Cursor supplied no model names for these billing items.</p> :
          <ul>{usage.models.map(row => <li key={JSON.stringify(row.model)}>{row.model ?? "Model unreported"} · {row.items.toLocaleString("en-US")} items · reported tokens: {count(row.tokens, row.partial)}</li>)}</ul>}
      </section>
    </> : <p>No imported Cursor billing items for this UTC day.</p>}
    <section className="space-y-2 rounded-lg border bg-card p-5">
      <h2 className="text-lg font-semibold">Which run caused this usage?</h2>
      <p>Personal billing exports omit run and automation IDs. Timing alone cannot tie these items to a job.</p>
      {identified.length > 0 ? <>
        <p>Cursor’s team API identifies sources for separately synced requests that day. Their totals may cover different accounts or activity.</p>
        <Link className="font-medium underline underline-offset-4" href={`/dashboard/ai-spend?cursor_day=${day}#cursor-sources`}>Review synced Cursor sources for {day}</Link>
      </> : <>
        {sources && <p>{sources.rows.length ? "Synced requests for this date have no source ID." : "No identified Cursor runs have been synced for this date."}</p>}
        <p>Check which agents ran that day and review their schedules in Cursor.</p>
        <a className="font-medium underline underline-offset-4" href="https://cursor.com/agents" rel="noreferrer">Open Cursor run history</a>
      </>}
    </section>
  </div>
}
