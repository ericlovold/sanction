import Link from "next/link"
import { db } from "@/lib/db"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { walletWindowOutcomes, walletWindowSpendUsd, windowStart } from "@/lib/outcomes"
import { subtreeWalletIds, frozenSubtreeWalletIds } from "@/lib/walletSubtree"

// Outcomes, as a section of Spend: cost-per-outcome is a spend lens (what the
// spend WAS FOR), not a place of its own. Formerly the /dashboard/outcomes
// page — that URL still lands here via redirect. Until anything reports an
// outcome the section is a single explainer line; the per-pool CPO read and
// recent-outcomes table appear once there's data to show.

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
  let kind = policy?.outcomeKind ?? null
  if (!kind) {
    const latest = await db.outcomeEvent.findFirst({
      where: { walletId: wallet.id },
      orderBy: { occurredAt: "desc" },
      select: { kind: true },
    })
    kind = latest?.kind ?? null
  }

  // Same reads the ceiling rule governs on (lib/outcomes) — the section's
  // numbers and the engine's can't drift.
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
    return <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">no ceiling</span>
  if (row.outcomes < row.minOutcomes)
    return <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">cold start · {row.outcomes}/{row.minOutcomes}</span>
  if (row.cpoUsd !== null && row.cpoUsd > row.ceilingUsd)
    return <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-400">THROTTLED — over ceiling</span>
  return <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-400">earning its cost</span>
}

function CpoBar({ row }: { row: PoolRow }) {
  if (row.ceilingUsd === null || row.cpoUsd === null) return null
  const p = Math.min(100, Math.round((row.cpoUsd / row.ceilingUsd) * 100))
  const over = row.cpoUsd > row.ceilingUsd
  return (
    <div className="mt-2">
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${over ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${p}%` }} />
      </div>
      <p className="mt-1 font-mono text-[11px] text-muted-foreground">
        {dollars(row.cpoUsd)} per {row.kind} · ceiling {dollars(row.ceilingUsd)}
      </p>
    </div>
  )
}

export async function OutcomesSection({ rootWalletId }: { rootWalletId: string }) {
  const { ids: subtreeIds } = await subtreeWalletIds(rootWalletId)
  const walletRows = await db.wallet.findMany({
    where: { id: { in: subtreeIds } },
    select: { id: true, name: true, parentId: true, frozenAt: true },
  })
  const self = walletRows.find((w) => w.id === rootWalletId)
  if (!self) return null

  const recent = await db.outcomeEvent.findMany({
    where: { walletId: { in: subtreeIds } },
    orderBy: { occurredAt: "desc" },
    take: 25,
    select: { id: true, walletId: true, kind: true, valueUsd: true, playLabel: true, occurredAt: true },
  })

  // Nothing reported anywhere → one explainer line, not a page of zeros.
  if (recent.length === 0) {
    return (
      <Card id="outcomes" className="border-border bg-card">
        <CardContent className="px-5 py-4">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Outcomes:</span> none reported yet. Report them from your
            systems — <code className="font-mono text-xs">POST /api/v1/outcomes</code> with an agent key, or the{" "}
            <code className="font-mono text-xs">sanction_log_outcome</code> MCP tool — and spend becomes accountable to
            results: a pool over its cost-per-outcome ceiling auto-throttles, every further dollar waiting on a human in{" "}
            <Link href="/dashboard/approvals" className="text-emerald-400 hover:text-primary">Approvals</Link>.
          </p>
        </CardContent>
      </Card>
    )
  }

  const frozenIds = frozenSubtreeWalletIds(walletRows)
  const ordered = [self, ...walletRows.filter((w) => w.id !== rootWalletId).sort((a, b) => a.name.localeCompare(b.name))]
  const rows = await Promise.all(ordered.map((w) => poolOutcomeRow(w, w.id === rootWalletId, frozenIds.has(w.id))))
  const nameOf = new Map(rows.map((r) => [r.id, r.name]))

  return (
    <div id="outcomes" className="space-y-6">
      <Card className="border-border bg-card">
        <CardHeader className="px-5 pt-5 pb-2">
          <CardTitle className="text-sm font-medium text-foreground">Outcomes · cost per result</CardTitle>
          <p className="text-xs text-muted-foreground">
            Spend accountable to results. A pool over its cost-per-outcome ceiling auto-throttles: every further dollar
            waits for a human in{" "}
            <Link href="/dashboard/approvals" className="text-emerald-400 hover:text-primary">Approvals</Link>.
          </p>
        </CardHeader>
        <CardContent className="space-y-5 px-5 pb-5">
          {rows.map((row) => (
            <div key={row.id} className="border-b border-border/60 pb-4 last:border-0 last:pb-0">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-sm text-foreground">{row.name}</span>
                  {row.isSelf && <span className="ml-2 text-[11px] text-muted-foreground">this wallet</span>}
                </div>
                <StatusPill row={row} />
              </div>
              <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs text-muted-foreground">
                <span>{row.outcomes.toLocaleString()} {row.kind ?? "outcomes"} / {row.windowDays}d</span>
                <span>{dollars(row.spendUsd)} spend</span>
                {row.cpoUsd !== null && <span className="text-muted-foreground">{dollars(row.cpoUsd)} each</span>}
              </div>
              <CpoBar row={row} />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader className="px-5 pt-5 pb-2"><CardTitle className="text-sm text-muted-foreground">Recent outcomes</CardTitle></CardHeader>
        <CardContent className="px-5 pb-5">
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
                  <td className="py-2 pr-4 text-muted-foreground">{nameOf.get(e.walletId) ?? e.walletId}</td>
                  <td className="py-2 pr-4">{e.kind}</td>
                  <td className="py-2 pr-4">{e.playLabel ?? "—"}</td>
                  <td className="py-2">{e.valueUsd == null ? "—" : dollars(e.valueUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
