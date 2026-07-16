import type { Metadata } from "next"
import Link from "next/link"
import { AlertTriangle } from "lucide-react"
import { db } from "@/lib/db"
import { buildObserveDigest, emptyTally } from "@/lib/observeDigest"
import { decisionCode } from "@/lib/decisions"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { EnforcementToggle } from "@/components/enforcement-toggle"
import { NoWallet } from "@/components/no-wallet"
import { getViewWallet } from "@/lib/session"
import { subtreeWalletIds } from "@/lib/walletSubtree"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Sanction — Observe",
  description: "Observe mode digest: what enforcement would have done, pool by pool, before anything binds.",
}

// C2: the monitoring digest for observe-mode pools. The engine already ran and
// persisted every truthful would-be decision (OBS-1); this page turns that
// record into the flip-to-enforce case: "last 7 days, these would have been
// denied or escalated — here they are." Nothing on this page is a simulation;
// it is the real ledger with enforcement stood down.

const WINDOW_DAYS = 7
// Aggregation cap — beyond this we digest the most recent rows and say so.
const MAX_ROWS = 2000

function dollars(n: number) {
  return `$${n.toFixed(2)}`
}

function utc(d: Date) {
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`
}

const statusBadge: Record<string, { label: string; cls: string }> = {
  denied: { label: "would deny", cls: "border-red-500/20 bg-red-500/15 text-red-400" },
  escalated: { label: "would escalate", cls: "border-amber-500/20 bg-amber-500/15 text-amber-400" },
  approved: { label: "would allow", cls: "border-emerald-500/20 bg-emerald-500/15 text-emerald-400" },
}

// The full read lives outside the component so the impure `Date.now()` window
// boundary is computed in the data layer, not during render (matches Pools).
async function loadObserve(rootId: string) {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const { ids: walletIds, truncated } = await subtreeWalletIds(rootId)
  const [wallets, agents] = await Promise.all([
    db.wallet.findMany({
      where: { id: { in: walletIds } },
      select: { id: true, name: true, policy: { select: { enforcementMode: true } } },
    }),
    db.agent.findMany({ where: { walletId: { in: walletIds } }, select: { id: true, name: true, walletId: true } }),
  ])
  const agentIds = agents.map((a) => a.id)
  const observedRows = agentIds.length
    ? await db.authorizationRequest.findMany({
      where: {
        agentId: { in: agentIds },
        createdAt: { gte: since },
        detailsJson: { path: ["observed"], equals: true },
      },
      orderBy: { createdAt: "desc" },
      take: MAX_ROWS,
      select: {
        id: true,
        agentId: true,
        kind: true,
        action: true,
        amountUsd: true,
        merchant: true,
        category: true,
        status: true,
        decisionNote: true,
        createdAt: true,
      },
    })
    : []
  return { walletIds, truncated, wallets, agents, observedRows }
}

export default async function ObservePage() {
  const view = await getViewWallet()
  if (!view) return <NoWallet />

  const { truncated, wallets, agents, observedRows } = await loadObserve(view.id)
  const agentToWallet = new Map(agents.map((a) => [a.id, a.walletId]))
  const agentName = new Map(agents.map((a) => [a.id, a.name]))
  const walletName = new Map(wallets.map((w) => [w.id, w.name]))
  const capped = observedRows.length === MAX_ROWS

  const digest = buildObserveDigest(observedRows, agentToWallet)
  const recent = observedRows.slice(0, 25)

  const withPolicy = wallets.filter((w) => w.policy)
  const observing = withPolicy.filter((w) => w.policy?.enforcementMode === "observe")
  // Pools observing first (they're what this page is about), then by name.
  const poolRows = withPolicy
    .map((w) => ({
      id: w.id,
      name: w.name,
      mode: (w.policy?.enforcementMode === "observe" ? "observe" : "enforce") as "observe" | "enforce",
      tally: digest.perWallet.get(w.id) ?? emptyTally(),
    }))
    .sort((a, b) => (a.mode === b.mode ? a.name.localeCompare(b.name) : a.mode === "observe" ? -1 : 1))

  return (
    <div className="mx-auto min-h-screen max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">Observe</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The engine runs, nothing blocks. This is what enforcement would have done in the last {WINDOW_DAYS} days —
            evidence for turning it on, pool by pool.
          </p>
        </div>
        {(truncated || capped) && (
          <span className="flex items-center gap-1 text-xs text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5" />
            {truncated ? "subtree truncated" : `digest covers the most recent ${MAX_ROWS} observed decisions`}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="border-border bg-card">
          <CardHeader className="px-4 pt-4 pb-1">
            <CardTitle className="text-xs font-normal text-muted-foreground">Pools observing</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="font-mono text-2xl font-semibold">{observing.length}<span className="text-sm text-muted-foreground"> / {withPolicy.length}</span></p>
            <p className="mt-1 text-xs text-muted-foreground">pools with a policy</p>
          </CardContent>
        </Card>
        <Card className="border-border bg-card">
          <CardHeader className="px-4 pt-4 pb-1">
            <CardTitle className="text-xs font-normal text-muted-foreground">Would have denied</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="font-mono text-2xl font-semibold text-red-400">{digest.totals.wouldDeny}</p>
            <p className="mt-1 text-xs text-muted-foreground">{dollars(digest.totals.deniedUsd)} would have been stopped</p>
          </CardContent>
        </Card>
        <Card className="border-border bg-card">
          <CardHeader className="px-4 pt-4 pb-1">
            <CardTitle className="text-xs font-normal text-muted-foreground">Would have escalated</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="font-mono text-2xl font-semibold text-amber-400">{digest.totals.wouldEscalate}</p>
            <p className="mt-1 text-xs text-muted-foreground">{dollars(digest.totals.escalatedUsd)} would have waited on a human</p>
          </CardContent>
        </Card>
        <Card className="border-border bg-card">
          <CardHeader className="px-4 pt-4 pb-1">
            <CardTitle className="text-xs font-normal text-muted-foreground">Decisions observed</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="font-mono text-2xl font-semibold">{digest.totals.total}</p>
            <p className="mt-1 text-xs text-muted-foreground">{digest.totals.wouldAllow} would have sailed through</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border bg-card">
        <CardHeader className="px-5 pt-5 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Pools</CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-5">
          {poolRows.length === 0 && (
            <EmptyState
              title="No governed pools yet"
              hint="Observe works per pool: give a pool a policy on the Policy page, switch it to observe, and every agent decision is logged without anything being blocked."
            />
          )}
          <div>
            {poolRows.map((pool) => (
              <div
                key={pool.id}
                className="grid gap-3 border-t border-border py-4 first:border-t-0 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.6fr)_auto] lg:items-center"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium text-foreground">{pool.name}</p>
                    <span
                      className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${
                        pool.mode === "observe"
                          ? "border-sky-500/20 bg-sky-500/15 text-sky-400"
                          : "border-emerald-500/20 bg-emerald-500/15 text-emerald-400"
                      }`}
                    >
                      {pool.mode === "observe" ? "observing" : "enforcing"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {pool.mode === "observe"
                      ? "Decisions log with enforcement stood down."
                      : "Decisions bind — denials block, escalations page."}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                  <div>
                    <p className="text-muted-foreground">Observed 7d</p>
                    <p className="mt-1 font-mono text-muted-foreground">{pool.tally.total}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Would deny</p>
                    <p className={`mt-1 font-mono ${pool.tally.wouldDeny > 0 ? "text-red-400" : "text-muted-foreground"}`}>
                      {pool.tally.wouldDeny} · {dollars(pool.tally.deniedUsd)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Would escalate</p>
                    <p className={`mt-1 font-mono ${pool.tally.wouldEscalate > 0 ? "text-amber-400" : "text-muted-foreground"}`}>
                      {pool.tally.wouldEscalate} · {dollars(pool.tally.escalatedUsd)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Would allow</p>
                    <p className="mt-1 font-mono text-muted-foreground">{pool.tally.wouldAllow}</p>
                  </div>
                </div>

                <EnforcementToggle walletId={pool.id} poolName={pool.name} mode={pool.mode} editable={view.isSession} />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(280px,0.8fr)]">
        <Card className="border-border bg-card">
          <CardHeader className="px-5 pt-5 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Recent observed decisions</CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            {recent.length === 0 && (
              <EmptyState
                title="Nothing observed yet"
                hint={`Switch a pool to observe and its agents' decisions land here — the truthful would-be outcome of every request, with nothing blocked. Agents keep working exactly as before.`}
              />
            )}
            <div>
              {recent.map((row) => {
                const badge = statusBadge[row.status] ?? statusBadge.approved
                const code = decisionCode(row.status, row.decisionNote)
                return (
                  <div key={row.id} className="border-t border-border py-3 first:border-t-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${badge.cls}`}>{badge.label}</span>
                      {code && <span className="font-mono text-[10px] text-muted-foreground">{code}</span>}
                      <span className="text-sm text-foreground">
                        {row.merchant}
                        {row.amountUsd > 0 ? ` · ${dollars(row.amountUsd)}` : ""}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {agentName.get(row.agentId) ?? "removed agent"}
                      {" · "}
                      {walletName.get(agentToWallet.get(row.agentId) ?? "") ?? "—"}
                      {" · "}
                      {row.kind}/{row.action}
                      {row.decisionNote ? ` · ${row.decisionNote}` : ""}
                      {" · "}
                      {utc(row.createdAt)}
                    </p>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader className="px-5 pt-5 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">What enforcement would flag</CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            {digest.topCodes.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No would-be denials or escalations in the window. Either the policy fits the traffic, or nothing is
                observing yet.
              </p>
            ) : (
              <div className="space-y-2">
                {digest.topCodes.map((c) => (
                  <div key={c.code} className="flex items-center justify-between gap-3">
                    <span className="font-mono text-xs text-muted-foreground">{c.code}</span>
                    <span className="font-mono text-xs text-foreground">{c.count}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-4 border-t border-border pt-3 text-[11px] leading-relaxed text-muted-foreground">
              Same engine, same ladder, same codes as enforcement — see{" "}
              <Link href="/dashboard/policy" className="text-emerald-400 hover:text-primary">Policy</Link> for the rules
              behind them. Turning enforcement on changes what happens, not what is decided.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
