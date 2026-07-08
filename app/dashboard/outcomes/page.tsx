import type { Metadata } from "next"
import Link from "next/link"
import { db } from "@/lib/db"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { NoWallet } from "@/components/no-wallet"
import { getViewWallet } from "@/lib/session"
import { walletWindowOutcomes, walletWindowSpendUsd, windowStart } from "@/lib/outcomes"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Sanction — Outcomes",
  description: "Cost per outcome across every pool — spend accountable to results, not just budgets.",
}

// The CFO read (CPO-1): a budget says what an agent MAY spend; an outcome says
// what the spend WAS FOR. This page divides one by the other, per pool, against
// the ceiling that throttles the channel when it stops earning its cost.

function dollars(n: number) {
  return `$${n.toFixed(2)}`
}

type PoolRow = {
  id: string
  name: string
  isSelf: boolean
  kind: string | null
  windowDays: number
  outcomes: number
  spendUsd: number
  cpoUsd: number | null
  ceilingUsd: number | null
  minOutcomes: number
  frozen: boolean
}

// ancestorFrozen: KILL-1 walks ancestors — a frozen parent stops every child
// pool, so the pill must reflect the walk, not just the pool's own flag.
async function poolOutcomeRow(wallet: { id: string; name: string; frozenAt: Date | null }, isSelf: boolean, ancestorFrozen = false): Promise<PoolRow> {
  const policy = await db.policy.findUnique({
    where: { walletId: wallet.id },
    select: {
      outcomeKind: true,
      costPerOutcomeCeilingUsd: true,
      costPerOutcomeWindowDays: true,
      costPerOutcomeMinOutcomes: true,
    },
  })
  const windowDays = policy?.costPerOutcomeWindowDays ?? 30
  const since = windowStart(windowDays)
  // Observed kind fallback: pools without a configured ceiling still report on
  // whatever outcome kind they actually receive, so the page is useful pre-policy.
  let kind = policy?.outcomeKind ?? null
  if (!kind) {
    const latest = await db.outcomeEvent.findFirst({
      where: { walletId: wallet.id },
      orderBy: { occurredAt: "desc" },
      select: { kind: true },
    })
    kind = latest?.kind ?? null
  }

  // Same reads the ceiling rule governs on (lib/outcomes) — the page's numbers
  // and the engine's can't drift.
  const [outcomes, spendUsd] = await Promise.all([
    kind ? walletWindowOutcomes(db, wallet.id, kind, since) : Promise.resolve(0),
    walletWindowSpendUsd(db, wallet.id, since),
  ])

  return {
    id: wallet.id,
    name: wallet.name,
    isSelf,
    kind,
    windowDays,
    outcomes,
    spendUsd,
    cpoUsd: outcomes > 0 ? spendUsd / outcomes : null,
    ceilingUsd: policy?.costPerOutcomeCeilingUsd == null ? null : policy.costPerOutcomeCeilingUsd / 100,
    minOutcomes: policy?.costPerOutcomeMinOutcomes ?? 5,
    frozen: wallet.frozenAt !== null || ancestorFrozen,
  }
}

function StatusPill({ row }: { row: PoolRow }) {
  if (row.frozen) return <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-400">FROZEN</span>
  if (row.ceilingUsd === null)
    return <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground0">no ceiling</span>
  if (row.outcomes < row.minOutcomes)
    return <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">cold start · {row.outcomes}/{row.minOutcomes}</span>
  if (row.cpoUsd !== null && row.cpoUsd > row.ceilingUsd)
    return <span className="rounded-full bg-ochre/10 px-2 py-0.5 text-[11px] font-medium text-ochre">THROTTLED — over ceiling</span>
  return <span className="rounded-full bg-signal/10 px-2 py-0.5 text-[11px] font-medium text-signal">earning its cost</span>
}

function CpoBar({ row }: { row: PoolRow }) {
  if (row.ceilingUsd === null || row.cpoUsd === null) return null
  const p = Math.min(100, Math.round((row.cpoUsd / row.ceilingUsd) * 100))
  const over = row.cpoUsd > row.ceilingUsd
  return (
    <div className="mt-2">
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${over ? "bg-ochre" : "bg-signal"}`} style={{ width: `${p}%` }} />
      </div>
      <p className="mt-1 font-mono text-[11px] text-foreground0">
        {dollars(row.cpoUsd)} per {row.kind} · ceiling {dollars(row.ceilingUsd)}
      </p>
    </div>
  )
}

export default async function OutcomesPage() {
  const view = await getViewWallet()
  if (!view) return <NoWallet />

  const [self, children] = await Promise.all([
    db.wallet.findUnique({ where: { id: view.id }, select: { id: true, name: true, frozenAt: true } }),
    db.wallet.findMany({ where: { parentId: view.id }, select: { id: true, name: true, frozenAt: true }, orderBy: { name: "asc" } }),
  ])
  if (!self) return <NoWallet />

  const selfFrozen = self.frozenAt !== null
  const rows = await Promise.all([poolOutcomeRow(self, true), ...children.map((c) => poolOutcomeRow(c, false, selfFrozen))])
  const reporting = rows.filter((r) => r.kind !== null)
  const totalOutcomes = reporting.reduce((s, r) => s + r.outcomes, 0)
  const totalSpend = rows.reduce((s, r) => s + r.spendUsd, 0)
  const blendedCpo = totalOutcomes > 0 ? totalSpend / totalOutcomes : null

  const recent = await db.outcomeEvent.findMany({
    where: { walletId: { in: rows.map((r) => r.id) } },
    orderBy: { occurredAt: "desc" },
    take: 25,
    select: { id: true, walletId: true, kind: true, valueUsd: true, playLabel: true, occurredAt: true },
  })
  const nameOf = new Map(rows.map((r) => [r.id, r.name]))

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6 md:p-10">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">Outcomes</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Spend accountable to results. A pool over its cost-per-outcome ceiling auto-throttles: every further
          dollar waits for a human in <Link href="/dashboard/approvals" className="text-foreground underline decoration-border underline-offset-2 hover:decoration-muted-foreground">Approvals</Link>.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs font-medium uppercase tracking-wider text-foreground0">Outcomes · window</CardTitle></CardHeader>
          <CardContent><p className="font-mono text-2xl text-foreground">{totalOutcomes.toLocaleString()}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs font-medium uppercase tracking-wider text-foreground0">Spend · window</CardTitle></CardHeader>
          <CardContent><p className="font-mono text-2xl text-foreground">{dollars(totalSpend)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs font-medium uppercase tracking-wider text-foreground0">Blended cost / outcome</CardTitle></CardHeader>
          <CardContent><p className="font-mono text-2xl text-foreground">{blendedCpo === null ? "—" : dollars(blendedCpo)}</p></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm text-foreground">By pool</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          {rows.map((row) => (
            <div key={row.id} className="border-b border-border pb-4 last:border-0 last:pb-0">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-sm text-foreground">{row.name}</span>
                  {row.isSelf && <span className="ml-2 text-[11px] text-muted-foreground">this wallet</span>}
                </div>
                <StatusPill row={row} />
              </div>
              <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs text-foreground0">
                <span>{row.outcomes.toLocaleString()} {row.kind ?? "outcomes"} / {row.windowDays}d</span>
                <span>{dollars(row.spendUsd)} spend</span>
                {row.cpoUsd !== null && <span className="text-foreground">{dollars(row.cpoUsd)} each</span>}
              </div>
              <CpoBar row={row} />
            </div>
          ))}
          {rows.length === 0 && <EmptyState title="No pools" hint="Create pools to see per-channel cost per outcome." />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm text-foreground">Recent outcomes</CardTitle></CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <EmptyState
              title="No outcomes reported yet"
              hint="Report them from your systems: POST /api/v1/outcomes with an agent key, or the sanction_log_outcome MCP tool. Idempotent via dedupe_key."
            />
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">When</th>
                  <th className="pb-2 pr-4 font-medium">Pool</th>
                  <th className="pb-2 pr-4 font-medium">Kind</th>
                  <th className="pb-2 pr-4 font-medium">Play</th>
                  <th className="pb-2 font-medium">Value</th>
                </tr>
              </thead>
              <tbody className="font-mono text-xs text-muted-foreground">
                {recent.map((e) => (
                  <tr key={e.id} className="border-b border-border last:border-0">
                    <td className="py-2 pr-4">{e.occurredAt.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                    <td className="py-2 pr-4 text-foreground">{nameOf.get(e.walletId) ?? e.walletId}</td>
                    <td className="py-2 pr-4">{e.kind}</td>
                    <td className="py-2 pr-4">{e.playLabel ?? "—"}</td>
                    <td className="py-2">{e.valueUsd == null ? "—" : dollars(e.valueUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
