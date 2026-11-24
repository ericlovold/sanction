import Link from "next/link"
import type { Metadata } from "next"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { NoWallet } from "@/components/no-wallet"
import { getViewWallet } from "@/lib/session"
import { hasRole } from "@/lib/roles"
import { fmtCount, fmtUsd } from "@/lib/format"
import { describeCursorVolume } from "@/lib/connectors/cursorVolume"
import { nanosToUsd } from "@/lib/connectors/money"
import { USAGE_PROVIDERS, usageProvider } from "@/lib/connectors/registry"
import { aiSpendView, type AiSpendView, type ConnectionHealth } from "@/lib/connectors/spendView"
import { disconnectUsageToolAction } from "./actions"
import { CursorSources } from "./cursor-sources"
import { ConnectToolForm, SyncNowForm } from "./connect-form"

export const dynamic = "force-dynamic"
// Connecting a tool reads up to 30 days of history inside the server action.
export const maxDuration = 300

export const metadata: Metadata = {
  title: "AI tools | Sanction",
  description: "Connect your AI tools and see usage and spend in one place.",
}

const usdOf = (nanos: bigint) => fmtUsd(nanosToUsd(nanos))
const stamp = (d: Date | null) => (d ? `${d.toISOString().slice(0, 16).replace("T", " ")} UTC` : "never")
const dayLabel = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })

const HEALTH: Record<ConnectionHealth, { label: string; tone: string }> = {
  ok: { label: "Connected", tone: "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-400" },
  waiting: { label: "Waiting for first pull", tone: "border-border text-muted-foreground" },
  stale: { label: "Stale", tone: "border-amber-500/30 bg-amber-500/[0.06] text-amber-400" },
  failing: { label: "Pulls failing", tone: "border-amber-500/30 bg-amber-500/[0.06] text-amber-400" },
  reconnect: { label: "Reconnect needed", tone: "border-red-500/30 bg-red-500/[0.06] text-red-400" },
}

const RULE: Record<string, string> = {
  runaway_rate: "Spend spiked far above this person's normal hour",
  headless_burn: "Background work kept spending with nobody at the keyboard",
  cursor_daily_volume: "High daily Cursor usage",
  daily_cap: "One person passed the daily spend line",
}

// Every figure names where it came from and how old it is. A number that
// looks live but is a day stale is worse than no number.
// The oldest "as of" among the connected tools: a combined figure is only as
// current as its stalest source. The per-tool times are listed once, up top.
function Source({ view }: { view: AiSpendView }) {
  const times = view.connections.map((c) => c.dataAsOf).filter((d): d is Date => !!d)
  if (!view.connections.length) return <p className="mt-1 text-[11px] text-muted-foreground">No tool connected</p>
  if (!times.length) return <p className="mt-1 text-[11px] text-muted-foreground">Waiting for the first pull</p>
  const oldest = new Date(Math.min(...times.map((d) => d.getTime())))
  return (
    <p className="mt-1 text-[11px] text-muted-foreground">
      data as of {stamp(oldest)}
      {view.connections.length > 1 && " (oldest source)"}
    </p>
  )
}

const sourceDayHref = (date: Date) => `?cursor_day=${date.toISOString().slice(0, 10)}#cursor-sources`

function DailyChart({ view, isAdmin }: { view: AiSpendView; isAdmin: boolean }) {
  const max = view.days.reduce((m, d) => (d.total > m ? d.total : m), BigInt(0))
  const providers = [...new Set(view.days.flatMap((d) => [...d.byProvider.keys()]))]
  return (
    <Card className="bg-card border-border">
      <CardHeader className="px-5 pt-5 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">Spend by day · last 30 days (UTC)</CardTitle>
        <Source view={view} />
      </CardHeader>
      <CardContent className="px-5 pb-5">
        <div className="flex h-36 gap-[2px]" role={isAdmin ? "group" : "img"} aria-label="Daily AI tool spend for the last 30 days. The same figures follow in a table.">
          {view.days.map((d, i) => (
            <div
              key={i}
              className="group relative flex flex-1 flex-col justify-end gap-[2px]"
              title={`${dayLabel(d.date)}: ${usdOf(d.total)}`}
            >
              <span className="pointer-events-none absolute -top-1 left-1/2 z-10 hidden -translate-x-1/2 -translate-y-full whitespace-nowrap rounded border border-border bg-popover px-1.5 py-0.5 text-[10px] font-mono text-foreground group-hover:block">
                {dayLabel(d.date)} · {usdOf(d.total)}
              </span>
              {isAdmin && (
                <Link href={sourceDayHref(d.date)} prefetch={false}
                  className="absolute inset-0 z-10 focus-visible:outline-2"
                  aria-label={`Show Cursor sources for ${dayLabel(d.date)} UTC, total AI spend ${usdOf(d.total)}`} />
              )}
              {providers.map((p) => {
                const cost = d.byProvider.get(p) ?? BigInt(0)
                if (cost <= BigInt(0) || max <= BigInt(0)) return null
                // Display-only ratio; the stored numbers stay integers.
                const pct = Math.max(1.5, (Number(cost) / Number(max)) * 100)
                return <div key={p} className="w-full rounded-t-[3px] opacity-85 group-hover:opacity-100" style={{ height: `${pct}%`, background: usageProvider(p)?.color ?? "#71717a" }} />
              })}
            </div>
          ))}
        </div>
        <div className="mt-1.5 flex justify-between text-[10px] font-mono text-muted-foreground">
          <span>{dayLabel(view.days[0].date)}</span>
          <span>peak day {usdOf(max)}</span>
          <span>{dayLabel(view.days[view.days.length - 1].date)}</span>
        </div>
        {providers.length > 1 && (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {providers.map((p) => (
              <span key={p} className="inline-flex items-center gap-1.5">
                <span aria-hidden className="h-2.5 w-2.5 rounded-[3px]" style={{ background: usageProvider(p)?.color ?? "#71717a" }} />
                {usageProvider(p)?.name ?? p}
              </span>
            ))}
          </div>
        )}
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-muted-foreground underline underline-offset-2">Show as a table</summary>
          <table className="mt-2 w-full max-w-sm text-left font-mono">
            <thead className="text-muted-foreground"><tr><th className="py-1 font-normal">Day</th><th className="py-1 text-right font-normal">Spend</th></tr></thead>
            <tbody>
              {view.days.filter((d) => d.total > BigInt(0)).map((d) => (
                <tr key={d.date.toISOString()} className="border-t border-border/60">
                  <td className="py-1">{isAdmin ? (
                    <Link href={sourceDayHref(d.date)} prefetch={false} className="underline underline-offset-2"
                      aria-label={`Show Cursor sources for ${dayLabel(d.date)} UTC`}>{dayLabel(d.date)}</Link>
                  ) : dayLabel(d.date)}</td>
                  <td className="py-1 text-right">{usdOf(d.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </CardContent>
    </Card>
  )
}

export default async function AiSpendPage({ searchParams }: { searchParams: Promise<{ cursor_day?: string | string[] }> }) {
  const wallet = await getViewWallet()
  if (!wallet) return <NoWallet />
  const isAdmin = wallet.isSession && hasRole(wallet.role, "admin")
  // Per-person spend is for admins. Everyone else, and the public demo view,
  // gets the totals without names.
  const view = await aiSpendView(wallet.id)
  const included = view.monthToDate - view.monthBilled - view.monthEstimated
  const billedNote = [
    included > BigInt(0) ? `${usdOf(included)} more was covered by plans` : null,
    view.monthEstimated > BigInt(0) ? `${usdOf(view.monthEstimated)} is an estimate, not billed yet` : null,
  ].filter(Boolean).join(" · ")

  return (
    <div className="min-h-screen p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">AI tools</h1>
        <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
          Connect the AI tools your team pays for and see who is spending what, in one place. These numbers are pulled from each
          tool&apos;s own reporting, so they run behind real time. Sanction watches them for runaway jobs and tells you; it cannot stop
          a tool that does not route through it.
        </p>
        {view.connections.length > 0 && (
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {view.connections.map((c) => (
              <span key={c.id} className="inline-flex items-center gap-1.5">
                <span aria-hidden className="h-2 w-2 rounded-[2px]" style={{ background: usageProvider(c.provider)?.color ?? "#71717a" }} />
                {usageProvider(c.provider)?.name ?? c.provider}{c.historical && " (retained history)"} as of <span className="font-mono">{stamp(c.dataAsOf)}</span>
              </span>
            ))}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          { label: "Month to date", value: usdOf(view.monthToDate), sub: `since ${dayLabel(view.monthStart)} UTC` },
          {
            label: "Billed so far",
            value: usdOf(view.monthBilled),
            sub: billedNote || "usage the tools charged for",
          },
          {
            label: "Forecast to month end",
            value: view.forecast === null ? "Too early" : usdOf(view.forecast),
            sub: view.forecast === null ? "needs three days of the month" : "straight-line run rate, not a promise",
          },
          {
            label: "Last month",
            value: view.lastMonthPartial && view.lastMonth === BigInt(0) ? "No data" : usdOf(view.lastMonth),
            sub: view.lastMonthPartial ? "partial coverage across tools" : "full month",
          },
        ].map((k) => (
          <Card key={k.label} className="bg-card border-border">
            <CardHeader className="px-4 pt-4 pb-1">
              <CardTitle className="text-xs font-normal text-muted-foreground">{k.label}</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className="font-mono text-2xl font-semibold">{k.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{k.sub}</p>
              <Source view={view} />
            </CardContent>
          </Card>
        ))}
      </div>

      {view.hasData && <DailyChart view={view} isAdmin={isAdmin} />}
      {isAdmin && <CursorSources walletId={wallet.id} day={(await searchParams).cursor_day} />}

      <Card className="bg-card border-border">
        <CardHeader className="px-5 pt-5 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Alerts</CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-5">
          {view.alerts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No guardrail has fired. Sanction checks every pull for an hour far above a person&apos;s normal, background work that keeps
              spending, high daily Cursor token or request volume, and any person past $50 in a day.
            </p>
          ) : (
            <ul className="space-y-3">
              {view.alerts.map((a) => (
                <li key={a.id} className="rounded-md border border-amber-500/25 bg-amber-500/[0.04] p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-medium">{RULE[a.rule] ?? a.rule}</p>
                    {isAdmin && !a.evidence.volume && (
                      <p className="font-mono text-sm">
                        {usdOf(a.observedNanos)} <span className="text-xs text-muted-foreground">against a line of {usdOf(a.thresholdNanos)}</span>
                      </p>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {usageProvider(a.provider)?.name ?? a.provider} · {stamp(a.windowStart)} to {stamp(a.windowEnd)}
                    {isAdmin && (
                      <>
                        {" "}· {a.subjectType === "person" ? a.evidence.identity : `${a.subjectType} ${a.subjectKey}, run by ${a.evidence.identity}`}
                      </>
                    )}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {isAdmin && (
                      <>
                        Billed portion: {usdOf(BigInt(a.evidence.billedNanos))}.{" "}
                        {a.evidence.baselineP95Nanos !== undefined &&
                          `Their normal busy hour over the previous week: ${usdOf(BigInt(a.evidence.baselineP95Nanos))}. `}
                      </>
                    )}
                    {a.notifiedAt ? `Emailed ${stamp(a.notifiedAt)}.` : "Found in history, so no email was sent."} Nothing was stopped.
                  </p>
                  {isAdmin && a.evidence.volume && (
                    <p className="mt-2 text-sm">{describeCursorVolume(a.evidence.volume)}{" "}
                      <Link className="underline" href={sourceDayHref(a.windowStart)}>View sources for this day</Link>
                    </p>
                  )}
                  {isAdmin && !a.evidence.volume && (
                    <details className="mt-2 text-xs">
                      <summary className="cursor-pointer text-muted-foreground underline underline-offset-2">Evidence</summary>
                      <table className="mt-2 w-full text-left font-mono">
                        <thead className="text-muted-foreground">
                          <tr><th className="py-1 font-normal">Hour (UTC)</th><th className="py-1 font-normal">Model</th><th className="py-1 font-normal">Conversation</th><th className="py-1 text-right font-normal">Cost</th></tr>
                        </thead>
                        <tbody>
                          {a.evidence.top.map((t, i) => (
                            <tr key={i} className="border-t border-border/60">
                              <td className="py-1">{t.hour.slice(0, 16).replace("T", " ")}</td>
                              <td className="py-1">{t.model}</td>
                              <td className="py-1" title={t.sessionRef ?? undefined}>{t.sessionRef ? t.sessionRef.slice(0, 13) : "none"}</td>
                              <td className="py-1 text-right">{usdOf(BigInt(t.costNanos))}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {view.hasData && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="bg-card border-border lg:col-span-3">
            <CardHeader className="px-5 pt-5 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">People · this month</CardTitle>
              <Source view={view} />
            </CardHeader>
            <CardContent className="px-5 pb-5">
              {!isAdmin ? (
                <p className="text-sm text-muted-foreground">Per-person spend is visible to wallet admins.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className="text-xs text-muted-foreground">
                      <tr>
                        <th className="py-2 pr-4 font-normal">Who</th>
                        <th className="py-2 pr-4 font-normal">Tools</th>
                        <th className="py-2 pr-4 font-normal whitespace-nowrap">Most-used model</th>
                        <th className="py-2 pl-4 text-right font-normal">Tokens</th>
                        <th className="py-2 pl-4 text-right font-normal">Billed</th>
                        <th className="py-2 pl-4 text-right font-normal">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.people.slice(0, 10).map((p) => (
                        <tr key={p.identity} className="border-t border-border/60 align-top">
                          <td className="py-2 pr-4">
                            {p.identity}
                            {p.identityType !== "user" && <span className="ml-2 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">Automation</span>}
                          </td>
                          <td className="py-2 pr-4 text-xs text-muted-foreground">
                            {p.tools.map(([tool, cost]) => (
                              <span key={tool} className="mr-3 inline-flex items-center gap-1.5 whitespace-nowrap">
                                <span aria-hidden className="h-2 w-2 rounded-[2px]" style={{ background: usageProvider(tool)?.color ?? "#71717a" }} />
                                {usageProvider(tool)?.name ?? tool}
                                {p.tools.length > 1 && <span className="font-mono">{usdOf(cost)}</span>}
                              </span>
                            ))}
                          </td>
                          <td className="py-2 pr-4 font-mono text-xs whitespace-nowrap">{p.topModel}</td>
                          <td className="py-2 pl-4 text-right font-mono">{fmtCount(Number(p.tokens))}</td>
                          <td className="py-2 pl-4 text-right font-mono">{usdOf(p.billed)}</td>
                          <td className="py-2 pl-4 text-right font-mono">{usdOf(p.cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {view.people.length > 10 && <p className="mt-2 text-xs text-muted-foreground">Top 10 of {view.people.length} by total.</p>}
                </div>
              )}
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardHeader className="px-5 pt-5 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Top models · this month</CardTitle>
              <Source view={view} />
            </CardHeader>
            <CardContent className="px-5 pb-5">
              <ul className="space-y-2 text-sm">
                {view.models.map((m) => (
                  <li key={`${m.provider}:${m.model}`} className="flex items-baseline justify-between gap-3">
                    <span className="truncate font-mono text-xs">{m.model}</span>
                    <span className="font-mono">{usdOf(m.cost)}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Connections</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {USAGE_PROVIDERS.map((p) => {
            const c = view.connections.find((x) => x.provider === p.id && !x.historical)
            const health = c ? HEALTH[c.health] : null
            return (
              <Card key={p.id} className="bg-card border-border">
                <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <span aria-hidden className="h-2.5 w-2.5 rounded-[3px]" style={{ background: p.color }} />
                    {c ? p.name : `Connect ${p.name}`}
                  </CardTitle>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] ${health?.tone ?? "border-border text-muted-foreground"}`}>
                    {health?.label ?? "Not connected"}
                  </span>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-3 text-xs">
                  <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
                    <div>
                      <dt className="text-muted-foreground">What it shows</dt>
                      <dd className="mt-0.5 space-y-0.5">{p.gives.map((g) => <p key={g}>{g}</p>)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">What it does not</dt>
                      <dd className="mt-0.5 space-y-0.5">{p.lacks.map((g) => <p key={g}>{g}</p>)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Freshness</dt>
                      <dd className="mt-0.5">{p.freshness}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Can Sanction stop spend here?</dt>
                      <dd className="mt-0.5">{p.canEnforce ? "Yes, with your approval." : "No. This connection is read-only: Sanction alerts, you act in the tool."}</dd>
                    </div>
                  </dl>

                  {c && (
                    <div className="rounded-md bg-muted/60 p-3 space-y-1">
                      <p>Last successful pull: <span className="font-mono">{stamp(c.lastSuccessAt)}</span></p>
                      {c.dataAsOf && c.lastSuccessAt && c.dataAsOf.getTime() < c.lastSuccessAt.getTime() && (
                        <p>{p.name} says its data is current to: <span className="font-mono">{stamp(c.dataAsOf)}</span></p>
                      )}
                      {c.lastRun && (
                        <p className="text-muted-foreground">
                          Last attempt {stamp(c.lastRun.startedAt)}: {c.lastRun.status === "ok" ? `${fmtCount(c.lastRun.factsWritten)} rows in ${c.lastRun.httpCalls} calls` : c.lastRun.status}
                        </p>
                      )}
                      {c.statusDetail && <p className="text-amber-400">{c.statusDetail}</p>}
                      {c.health === "stale" && <p className="text-amber-400">No successful pull in twice the usual interval. Figures above are older than they should be.</p>}
                      <p className="text-muted-foreground">Key stored {c.keyAgeDays} day{c.keyAgeDays === 1 ? "" : "s"} ago{c.connectedByEmail && isAdmin ? ` by ${c.connectedByEmail}` : ""}.</p>
                      {c.keyIsOld && (
                        <p className="text-amber-400">
                          This key is over 90 days old. <a className="underline underline-offset-2" href={p.rotationUrl} rel="noreferrer" target="_blank">Create a new one in {p.name}</a>, then replace it below.
                        </p>
                      )}
                    </div>
                  )}

                  {p.routes && (
                    <div>
                      <p className="text-muted-foreground">How does your team use {p.name}?</p>
                      <ul className="mt-1 space-y-1">
                        {p.routes.map((r) => (
                          <li key={r.label} className="flex gap-2">
                            <span className={`mt-0.5 shrink-0 rounded border px-1.5 text-[10px] leading-4 ${r.available ? "border-emerald-500/30 text-emerald-500" : "border-border text-muted-foreground"}`}>
                              {r.available ? "Available" : "Not yet"}
                            </span>
                            <span><span className="font-medium">{r.label}.</span> <span className="text-muted-foreground">{r.note}</span></span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {isAdmin ? (
                    <>
                      {!c && (
                        <ol className="list-decimal space-y-1 pl-4 text-muted-foreground">
                          <li>In {p.name}, open <span className="text-foreground">{p.keyLocation}</span>.</li>
                          <li>Pick the narrowest scope offered. Sanction only reads usage; try a read-only key first.</li>
                          <li>Paste the key here. Sanction checks it, encrypts it, and never shows it again.</li>
                        </ol>
                      )}
                      <ConnectToolForm provider={p.id} name={p.name} rekey={!!c} />
                      {c && (
                        <div className="flex flex-wrap items-start justify-between gap-3 border-t border-border/60 pt-3">
                          <SyncNowForm connectionId={c.id} />
                          <form action={disconnectUsageToolAction} className="flex items-center gap-3">
                            <input type="hidden" name="connection_id" value={c.id} />
                            <label className="flex items-center gap-1.5 text-muted-foreground">
                              <input type="checkbox" name="delete_data" /> Delete data too
                            </label>
                            <button type="submit" className="rounded-md border border-red-500/30 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/[0.06]">
                              Disconnect
                            </button>
                          </form>
                        </div>
                      )}
                      <p className="text-muted-foreground">
                        Disconnecting deletes the stored key immediately. Usage history stays unless you tick the box.{" "}
                        <a className="underline underline-offset-2" href={p.keyHelpUrl} rel="noreferrer" target="_blank">{p.name} API key docs</a>
                      </p>
                    </>
                  ) : (
                    <p className="text-muted-foreground">A wallet admin can connect or disconnect this tool.</p>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          Sanction reads usage metadata only: tokens, cost, model, and the account that used them. It never requests prompts or responses.
          Figures marked as estimates are replaced by billed amounts once the tool reports them.
        </p>
      </div>
    </div>
  )
}
