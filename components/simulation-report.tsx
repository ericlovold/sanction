import type { SimulationReport } from "@/app/dashboard/policy/actions"

// Renders the runSimulation honesty envelope verbatim — as_recorded state,
// was/would tallies, approved-spend delta, per-row changes, and every caveat
// (ignored_fields, unreplayable/out-of-scope counts, truncation). Swallowing
// any of these would misrepresent what the simulation actually covered, which
// is the whole point of the envelope.

const effectColor: Record<string, string> = {
  allow: "text-emerald-400",
  escalate: "text-amber-400",
  deny: "text-red-400",
}

function Tally({ label, t }: { label: string; t: { allow: number; escalate: number; deny: number } }) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
      <p className="text-[11px] uppercase tracking-wide text-zinc-600">{label}</p>
      <div className="mt-2 flex gap-4 font-mono text-sm">
        <span className={effectColor.allow}>{t.allow} allow</span>
        <span className={effectColor.escalate}>{t.escalate} esc</span>
        <span className={effectColor.deny}>{t.deny} deny</span>
      </div>
    </div>
  )
}

export function SimulationReport({ report, title }: { report: SimulationReport; title: string }) {
  const { totals, counts, approved_spend_usd, changes } = report
  const ignored = "ignored_fields" in report ? report.ignored_fields : undefined
  const truncated = "truncated" in report ? report.truncated : undefined
  const noteTruncated = "note_truncated" in report ? report.note_truncated : undefined
  const spendDelta = approved_spend_usd.would - approved_spend_usd.was

  return (
    <div className="space-y-3 rounded-md border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium text-zinc-200">{title}</h3>
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500">
          {report.state}
        </span>
      </div>

      <p className="text-[11px] leading-relaxed text-zinc-600">{report.note}</p>

      {counts.considered === 0 ? (
        <p className="text-xs text-zinc-500">No decisions in the window — nothing to simulate yet.</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Tally label="Recorded (was)" t={totals.was} />
            <Tally label="Candidate (would)" t={totals.would} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
              <p className="text-[11px] uppercase tracking-wide text-zinc-600">Approved spend</p>
              <p className="mt-2 font-mono text-sm text-zinc-100">
                ${approved_spend_usd.was.toFixed(2)} → ${approved_spend_usd.would.toFixed(2)}
                <span className={`ml-2 text-xs ${spendDelta > 0 ? "text-red-400" : spendDelta < 0 ? "text-emerald-400" : "text-zinc-500"}`}>
                  {spendDelta > 0 ? "+" : ""}${spendDelta.toFixed(2)}
                </span>
              </p>
            </div>
            <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
              <p className="text-[11px] uppercase tracking-wide text-zinc-600">Coverage</p>
              <p className="mt-2 font-mono text-xs text-zinc-400">
                {counts.simulated}/{counts.considered} simulated · {counts.changed} changed
              </p>
              {(counts.out_of_scope > 0 || counts.unreplayable > 0) && (
                <p className="mt-1 font-mono text-[11px] text-zinc-600">
                  {counts.out_of_scope} out of scope · {counts.unreplayable} unreplayable
                </p>
              )}
            </div>
          </div>

          {changes.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-zinc-600">
                    <th className="pb-1 pr-3 font-normal">When</th>
                    <th className="pb-1 pr-3 font-normal">Agent</th>
                    <th className="pb-1 pr-3 font-normal">Action</th>
                    <th className="pb-1 pr-3 font-normal">Was</th>
                    <th className="pb-1 font-normal">Would</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-zinc-400">
                  {changes.map((c) => {
                    const row = c as {
                      id: string; at: string; agent?: string; action?: string; merchant?: string
                      was: { effect: string }; would: { effect: string }
                    }
                    return (
                      <tr key={row.id} className="border-t border-zinc-900">
                        <td className="py-1 pr-3 whitespace-nowrap text-zinc-500">{row.at.slice(0, 10)}</td>
                        <td className="py-1 pr-3 text-zinc-300">{row.agent ?? "—"}</td>
                        <td className="py-1 pr-3 text-zinc-400">{row.merchant ?? row.action ?? "—"}</td>
                        <td className={`py-1 pr-3 ${effectColor[row.was.effect] ?? "text-zinc-400"}`}>{row.was.effect}</td>
                        <td className={`py-1 ${effectColor[row.would.effect] ?? "text-zinc-400"}`}>{row.would.effect}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {ignored && ignored.length > 0 && (
        <p className="text-[11px] text-amber-400/80">
          Not simulated (tool / provision ladders aren&rsquo;t overlaid): <span className="font-mono">{ignored.join(", ")}</span>
        </p>
      )}
      {truncated && (
        <p className="text-[11px] text-amber-400/80">{noteTruncated ?? "Results were truncated."}</p>
      )}
    </div>
  )
}
