import type { Metadata } from "next"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { NoWallet } from "@/components/no-wallet"
import { getViewWallet } from "@/lib/session"
import { rangeUtc } from "@/lib/reporting"
import { buildPeriodSummary } from "@/lib/reportingSummary"
import { buildAuditFeed, type AuditEvent } from "@/lib/auditFeed"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Sanction — Audit",
  description: "The evidence trail: period totals, decision mix, per-agent rollup, and every action your agents took.",
}

const FEED_LIMIT = 50

function dollars(n: number) {
  return `$${n.toFixed(2)}`
}
function cost(n: number) {
  return `$${n.toFixed(n < 1 ? 4 : 2)}`
}
function isoDay(offsetDays: number) {
  return new Date(Date.now() - offsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

// Pull a human detail + a headline value off a loosely-typed audit event.
function eventDetail(e: AuditEvent): { detail: string; value: string; tone: string } {
  if (e.type === "token.logged") {
    return { detail: String(e.model ?? "model"), value: cost(Number(e.cost_usd ?? 0)), tone: "text-zinc-400" }
  }
  if (e.type === "vault.injection") {
    return { detail: `secret · ${String(e.credential_label ?? "")}`, value: "—", tone: "text-violet-400" }
  }
  // authorization events (spend.approved / spend.denied / spend.escalated)
  const merchant = e.merchant ? String(e.merchant) : e.action ? String(e.action) : "—"
  const status = String(e.status ?? "")
  const tone =
    status === "approved" ? "text-emerald-400" : status === "denied" ? "text-red-400" : status === "escalated" ? "text-amber-400" : "text-zinc-400"
  return { detail: merchant, value: e.amount_usd != null ? dollars(Number(e.amount_usd)) : "—", tone }
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardContent className="px-4 py-3.5">
        <p className="text-[11px] uppercase tracking-wide text-zinc-600">{label}</p>
        <p className="mt-1 font-mono text-xl text-zinc-100 tabular-nums">{value}</p>
        {sub && <p className="mt-0.5 text-[11px] text-zinc-600">{sub}</p>}
      </CardContent>
    </Card>
  )
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const view = await getViewWallet()
  if (!view) return <NoWallet />

  const sp = await searchParams
  const defFrom = isoDay(6)
  const defTo = isoDay(0)
  const from = sp.from || defFrom
  const to = sp.to || defTo

  let start: Date, end: Date, rangeError: string | null = null
  try {
    ;({ start, end } = rangeUtc(from, to))
  } catch (e) {
    // Fall back to the default 7-day window rather than error the whole page.
    ;({ start, end } = rangeUtc(defFrom, defTo))
    rangeError = e instanceof Error ? e.message : "invalid range"
  }

  const [summary, feed] = await Promise.all([
    buildPeriodSummary(view.id, { start, end, groupByAgent: true }),
    buildAuditFeed(view.id, { limit: FEED_LIMIT }),
  ])
  const { totals } = summary
  const byAgent = summary.by_agent ?? []

  return (
    <div className="min-h-screen mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight text-zinc-100">Audit</h1>
          <p className="mt-1 text-sm text-zinc-500">
            The evidence trail. Every decision, token charge, and secret access — already current for when the assessor asks.
          </p>
        </div>
        {/* Range control drives the period summary; a plain GET form, no client JS. */}
        <form method="get" className="flex items-end gap-2">
          <label className="block">
            <span className="text-[10px] uppercase tracking-wide text-zinc-600">From</span>
            <input
              type="date"
              name="from"
              defaultValue={from}
              max={to}
              className="mt-1 block rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 font-mono text-xs text-zinc-100 outline-none focus:border-zinc-600"
            />
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wide text-zinc-600">To</span>
            <input
              type="date"
              name="to"
              defaultValue={to}
              max={defTo}
              className="mt-1 block rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 font-mono text-xs text-zinc-100 outline-none focus:border-zinc-600"
            />
          </label>
          <button
            type="submit"
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-500"
          >
            Apply
          </button>
        </form>
      </div>

      {rangeError && (
        <p className="rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-400">
          {rangeError} — showing the last 7 days instead.
        </p>
      )}

      {/* Period KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi label="Approved spend" value={dollars(totals.spend_usd)} sub={`${from} → ${to}`} />
        <Kpi label="Token cost" value={cost(totals.token_cost_usd)} sub={`${totals.tokens_in + totals.tokens_out} tokens`} />
        <Kpi label="Approved" value={String(totals.decisions.approved ?? 0)} sub="decisions" />
        <Kpi
          label="Denied · escalated"
          value={`${totals.decisions.denied ?? 0} · ${totals.decisions.escalated ?? 0}`}
          sub="held back"
        />
        <Kpi label="Secret accesses" value={String(totals.secret_accesses)} sub="vault injections" />
      </div>

      {/* Per-agent rollup */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader className="px-5 pt-5 pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-medium text-zinc-300">By agent</CardTitle>
          {view.isSession ? (
            <a
              href={`/dashboard/audit/export`}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-500"
            >
              Download recent (CSV)
            </a>
          ) : (
            <span className="text-[11px] text-zinc-600">Log in to export</span>
          )}
        </CardHeader>
        <CardContent className="px-5 pb-5">
          {byAgent.length === 0 ? (
            <p className="text-sm text-zinc-600">No agents on this wallet yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-zinc-600">
                    <th className="pb-2 pr-3 font-normal">Agent</th>
                    <th className="pb-2 pr-3 text-right font-normal">Spend</th>
                    <th className="pb-2 pr-3 text-right font-normal">Approved</th>
                    <th className="pb-2 pr-3 text-right font-normal">Denied</th>
                    <th className="pb-2 pr-3 text-right font-normal">Escalated</th>
                    <th className="pb-2 text-right font-normal">Token cost</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-zinc-300 tabular-nums">
                  {byAgent.map((a) => (
                    <tr key={a.agent_id} className="border-t border-zinc-900">
                      <td className="py-1.5 pr-3 font-sans text-zinc-200">{a.agent_name ?? a.agent_id.slice(0, 8)}</td>
                      <td className="py-1.5 pr-3 text-right">{dollars(a.spend_usd)}</td>
                      <td className="py-1.5 pr-3 text-right text-emerald-400">{a.approved}</td>
                      <td className="py-1.5 pr-3 text-right text-red-400">{a.denied}</td>
                      <td className="py-1.5 pr-3 text-right text-amber-400">{a.escalated}</td>
                      <td className="py-1.5 text-right">{cost(a.token_cost_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent activity feed — latest events, not range-bound (the summary above is). */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader className="px-5 pt-5 pb-2">
          <CardTitle className="text-sm font-medium text-zinc-300">Recent activity</CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-5">
          {feed.events.length === 0 ? (
            <p className="text-sm text-zinc-600">No activity recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-zinc-600">
                    <th className="pb-2 pr-3 font-normal">When</th>
                    <th className="pb-2 pr-3 font-normal">Agent</th>
                    <th className="pb-2 pr-3 font-normal">Event</th>
                    <th className="pb-2 pr-3 font-normal">Detail</th>
                    <th className="pb-2 text-right font-normal">Value</th>
                  </tr>
                </thead>
                <tbody className="text-zinc-300">
                  {feed.events.map((e) => {
                    const d = eventDetail(e)
                    return (
                      <tr key={`${e.type}-${e.id}`} className="border-t border-zinc-900">
                        <td className="py-1.5 pr-3 whitespace-nowrap font-mono text-xs text-zinc-500 tabular-nums">
                          {e.at.slice(0, 16).replace("T", " ")}
                        </td>
                        <td className="py-1.5 pr-3 text-zinc-200">{e.agent_name ?? String(e.agent_id).slice(0, 8)}</td>
                        <td className={`py-1.5 pr-3 font-mono text-xs ${d.tone}`}>{e.type}</td>
                        <td className="py-1.5 pr-3 text-zinc-400">{d.detail}</td>
                        <td className="py-1.5 text-right font-mono tabular-nums text-zinc-200">{d.value}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-[11px] text-zinc-600">Latest {FEED_LIMIT} events. Export includes the most recent 200.</p>
        </CardContent>
      </Card>
    </div>
  )
}
