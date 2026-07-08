import type { SimulationReport } from "@/app/dashboard/policy/actions"

// Renders the runSimulation honesty envelope — but in the user's language, not
// the engine's. The envelope is still shown in full (nothing swallowed), yet
// every surface answers three questions: what am I looking at, is this good or
// bad, what do I do next. Raw field names and internal terms ("ladders",
// "as_recorded") get translated; the "unaffected settings" note reads as
// information, not an error.

const effectColor: Record<string, string> = {
  allow: "text-signal",
  escalate: "text-ochre",
  deny: "text-red-400",
}

// Engine field names → the labels the policy editor already shows.
const FIELD_LABEL: Record<string, string> = {
  daily_token_budget_usd: "Daily token budget",
  daily_spend_budget_usd: "Daily spend budget",
  monthly_spend_budget_usd: "Monthly spend budget",
  subtree_daily_cap_usd: "Subtree daily cap",
  per_transaction_max_usd: "Per-transaction max",
  auto_approve_under_usd: "Auto-approve under",
  escalate_over_usd: "Escalate over",
  allowed_categories: "Allowed categories",
  blocked_categories: "Blocked categories",
  allowed_tools: "Allowed tools",
  blocked_tools: "Blocked tools",
  escalate_tools: "Escalate tools",
  capability_rules: "Capability rules",
  escalation_timeout_mins: "Escalation timeout",
  escalation_timeout_action: "On timeout",
}

const STATE_LABEL: Record<string, string> = { as_recorded: "Based on your history" }

export function humanField(name: string): string {
  if (FIELD_LABEL[name]) return FIELD_LABEL[name]
  // Fallback: prettify an unknown field name rather than leak the raw token.
  return name.replace(/_usd$/, "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
}

function Tally({ label, t }: { label: string; t: { allow: number; escalate: number; deny: number } }) {
  return (
    <div className="rounded-md border border-border bg-muted/40 p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
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
  const hasActivity = counts.considered > 0

  const verdict =
    counts.changed === 0
      ? "Nothing would change — this policy matches every decision already on record."
      : `${counts.changed} of ${counts.simulated} replayed decision${counts.simulated === 1 ? "" : "s"} would change under this policy. Review the rows below before you save.`

  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/40 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <span className="rounded border border-input px-1.5 py-0.5 text-[10px] text-foreground0" title="Your real past decisions, replayed under the policy shown — nothing is saved.">
          {STATE_LABEL[report.state] ?? report.state}
        </span>
      </div>

      {/* What am I looking at? */}
      <p className="text-xs leading-relaxed text-foreground0">
        Your recent decisions replayed under the policy shown, so you can see what would change before you commit.
        Read-only — nothing is saved.
      </p>

      {!hasActivity ? (
        // Guiding empty state — what's missing AND what to do about it.
        <div className="rounded-md border border-border bg-muted/40 px-3 py-3">
          <p className="text-xs text-foreground">No agent activity in this window yet, so there&rsquo;s nothing to replay.</p>
          <p className="mt-1 text-[11px] leading-relaxed text-foreground0">
            Simulation compares a candidate policy against your real past decisions. Once your agents start making
            requests, come back to test changes safely before saving. Have older activity? Widen the date range.
          </p>
        </div>
      ) : (
        <>
          {/* Is this good or bad? */}
          <p className={`text-xs font-medium ${counts.changed === 0 ? "text-signal" : "text-ochre"}`}>{verdict}</p>

          <div className="grid gap-3 sm:grid-cols-2">
            <Tally label="Recorded (was)" t={totals.was} />
            <Tally label="Under this policy (would)" t={totals.would} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-border bg-muted/40 p-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Approved spend</p>
              <p className="mt-2 font-mono text-sm text-foreground">
                ${approved_spend_usd.was.toFixed(2)} → ${approved_spend_usd.would.toFixed(2)}
                <span className={`ml-2 text-xs ${spendDelta > 0 ? "text-red-400" : spendDelta < 0 ? "text-signal" : "text-foreground0"}`}>
                  {spendDelta > 0 ? "+" : ""}${spendDelta.toFixed(2)}
                </span>
              </p>
            </div>
            <div className="rounded-md border border-border bg-muted/40 p-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Coverage</p>
              <p className="mt-2 font-mono text-xs text-muted-foreground">
                {counts.simulated}/{counts.considered} simulated · {counts.changed} changed
              </p>
              {(counts.out_of_scope > 0 || counts.unreplayable > 0) && (
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                  {counts.out_of_scope} out of scope · {counts.unreplayable} unreplayable
                </p>
              )}
            </div>
          </div>

          {changes.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="pb-1 pr-3 font-normal">When</th>
                    <th className="pb-1 pr-3 font-normal">Agent</th>
                    <th className="pb-1 pr-3 font-normal">Action</th>
                    <th className="pb-1 pr-3 font-normal">Was</th>
                    <th className="pb-1 font-normal">Would</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-muted-foreground">
                  {changes.map((c) => {
                    const row = c as {
                      id: string; at: string; agent?: string; action?: string; merchant?: string
                      was: { effect: string }; would: { effect: string }
                    }
                    return (
                      <tr key={row.id} className="border-t border-border">
                        <td className="py-1 pr-3 whitespace-nowrap text-foreground0">{row.at.slice(0, 10)}</td>
                        <td className="py-1 pr-3 text-foreground">{row.agent ?? "—"}</td>
                        <td className="py-1 pr-3 text-muted-foreground">{row.merchant ?? row.action ?? "—"}</td>
                        <td className={`py-1 pr-3 ${effectColor[row.was.effect] ?? "text-muted-foreground"}`}>{row.was.effect}</td>
                        <td className={`py-1 ${effectColor[row.would.effect] ?? "text-muted-foreground"}`}>{row.would.effect}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Informational, NOT a warning: which of the editor's settings this kind
          of simulation doesn't touch, in plain language + human labels. */}
      {ignored && ignored.length > 0 && (
        <div className="rounded-md border border-border bg-card px-3 py-2.5">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">These settings don&rsquo;t affect this result.</span> A spend
            simulation replays each past decision against your spend budgets and categories. The settings below govern
            other things — tools, token metering, escalation timeouts, and sub-wallet caps — which are enforced live on
            new requests, not replayed here. Expected, not an error.
          </p>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Unaffected: <span className="text-foreground0">{ignored.map(humanField).join(" · ")}</span>
          </p>
        </div>
      )}
      {truncated && (
        <p className="text-[11px] text-ochre/80">
          {noteTruncated ?? "Only the most recent decisions were simulated — narrow the date range for a complete picture."}
        </p>
      )}
    </div>
  )
}
