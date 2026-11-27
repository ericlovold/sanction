import Link from "next/link"
import { db } from "@/lib/db"
import { walletWindowOutcomes, walletWindowSpendUsd, windowStart } from "@/lib/outcomes"
import { subtreeWalletIds, frozenSubtreeWalletIds } from "@/lib/walletSubtree"
import { fmtUsd } from "@/lib/format"

// Outcomes, as a section of Spend: cost-per-outcome is a spend lens (what the
// spend WAS FOR), not a place of its own. Formerly the /dashboard/outcomes
// page — that URL still lands here via redirect. Until anything reports an
// outcome the section is a single explainer line; the per-pool CPO read and
// recent-outcomes table appear once there's data to show.

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
  if (row.frozen) return <span className="dec-pill dec-denied">Frozen</span>
  if (row.ceilingUsd === null) return <span className="dec-pill dec-expired">No ceiling</span>
  if (row.outcomes < row.minOutcomes)
    return <span className="dec-pill dec-expired">Too few to judge · {row.outcomes} of {row.minOutcomes}</span>
  if (row.cpoUsd !== null && row.cpoUsd > row.ceilingUsd)
    return <span className="dec-pill sp-pill-wait">Over its ceiling</span>
  return <span className="dec-pill dec-approved">Within its ceiling</span>
}

function CpoBar({ row }: { row: PoolRow }) {
  if (row.ceilingUsd === null || row.cpoUsd === null) return null
  const fill = Math.min(100, (row.cpoUsd / row.ceilingUsd) * 100)
  const over = row.cpoUsd > row.ceilingUsd
  return (
    <div className="sp-meter sp-cpo" data-state={over ? "near" : "ok"}>
      <div className="sp-track" role="img" aria-label={`${Math.round((row.cpoUsd / row.ceilingUsd) * 100)}% of the ceiling`}>
        <span style={{ width: `${fill}%` }} />
      </div>
      <p className="sp-meter-note">
        {fmtUsd(row.cpoUsd)} per {row.kind}, ceiling {fmtUsd(row.ceilingUsd)}
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
      <section id="outcomes" className="home-section" aria-labelledby="sp-outcomes">
        <h2 id="sp-outcomes" className="home-h2">Outcomes</h2>
        <p className="pol-lede sp-outcomes-none">
          None reported yet. Report a result from your systems with <code className="pol-mono">POST /api/v1/outcomes</code>{" "}
          and an agent key, or with the <code className="pol-mono">sanction_log_outcome</code> MCP tool, and this page
          shows what each result cost. A group whose cost per outcome goes over its ceiling is slowed down: every further
          dollar waits for a person in{" "}
          <Link href="/dashboard/approvals" className="home-link">Approvals</Link>.
        </p>
      </section>
    )
  }

  const frozenIds = frozenSubtreeWalletIds(walletRows)
  const ordered = [self, ...walletRows.filter((w) => w.id !== rootWalletId).sort((a, b) => a.name.localeCompare(b.name))]
  const rows = await Promise.all(ordered.map((w) => poolOutcomeRow(w, w.id === rootWalletId, frozenIds.has(w.id))))
  const nameOf = new Map(rows.map((r) => [r.id, r.name]))

  return (
    <section id="outcomes" className="home-section" aria-labelledby="sp-outcomes">
      <h2 id="sp-outcomes" className="home-h2">Outcomes <span>cost per result</span></h2>
      <p className="pol-lede">
        What each reported result cost. A group over its ceiling is slowed down: every further dollar waits for a person
        in <Link href="/dashboard/approvals" className="home-link">Approvals</Link>.
      </p>
      <div className="g-panel">
        {rows.map((row) => (
          <div key={row.id} className="sp-out-row">
            <div className="sp-out-top">
              <p className="set-title">
                {row.name}
                {row.isSelf && <span className="sp-limit-kind">this wallet</span>}
              </p>
              <StatusPill row={row} />
            </div>
            <p className="set-body">
              {row.outcomes.toLocaleString("en-US")} {row.kind ?? "outcomes"} in {row.windowDays} days · {fmtUsd(row.spendUsd)} spent
              {row.cpoUsd !== null && ` · ${fmtUsd(row.cpoUsd)} each`}
            </p>
            <CpoBar row={row} />
          </div>
        ))}
      </div>

      <h3 className="sp-h3">Recent outcomes</h3>
      <div className="g-panel sp-table-wrap">
        <table className="sp-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Group</th>
              <th>Kind</th>
              <th>Play</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((e) => (
              <tr key={e.id}>
                <td>{e.occurredAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                <td>{nameOf.get(e.walletId) ?? e.walletId}</td>
                <td>{e.kind}</td>
                <td>{e.playLabel ?? "None"}</td>
                <td>{e.valueUsd == null ? "Not given" : fmtUsd(e.valueUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
