import { db } from "./db"
import { isDecisionEvidence } from "./evidence"
import { simulateEvidence, partitionFields } from "./simulate"
import type { PolicyInput } from "./policy"

// The SIM-1 aggregation loop, shared by POST /policy/simulate and the policy
// pack preview so "what would this policy have done" is always the same code
// answering. Read + compute only. Callers own auth, range parsing, and the
// no-simulatable-fields 400; this owns the honesty envelope.

export const MAX_ROWS = 5000
export const MAX_CHANGES = 100

export async function runSimulation(walletId: string, policy: PolicyInput, start: Date, end: Date) {
  const { applied, ignored } = partitionFields(policy)

  const agents = await db.agent.findMany({ where: { walletId }, select: { id: true, name: true } })
  const nameOf = new Map(agents.map((a) => [a.id, a.name]))
  const rows = await db.authorizationRequest.findMany({
    where: { agentId: { in: agents.map((a) => a.id) }, createdAt: { gte: start, lt: end } },
    orderBy: { createdAt: "asc" },
    take: MAX_ROWS + 1,
    select: {
      id: true, createdAt: true, agentId: true, action: true, merchant: true,
      amountUsd: true, status: true, decisionContextJson: true,
    },
  })
  const truncated = rows.length > MAX_ROWS
  const considered = rows.slice(0, MAX_ROWS)

  const totals = {
    was: { allow: 0, escalate: 0, deny: 0 },
    would: { allow: 0, escalate: 0, deny: 0 },
  }
  const spend = { was: 0, would: 0 }
  const counts = { considered: considered.length, simulated: 0, changed: 0, out_of_scope: 0, unreplayable: 0 }
  const changes: Array<Record<string, unknown>> = []

  for (const r of considered) {
    const e = r.decisionContextJson
    if (!isDecisionEvidence(e)) {
      counts.unreplayable++ // pre-EVID-1 rows have no stored context — never guess at one
      continue
    }
    let sim: ReturnType<typeof simulateEvidence>
    try {
      sim = simulateEvidence(e, policy)
    } catch {
      // A well-formed envelope can still hold a stale/incomplete ctx the rules
      // choke on; one bad row must not fail the whole simulation.
      counts.unreplayable++
      continue
    }
    if (sim === null) {
      counts.out_of_scope++ // provision/tool ladders: not overlaid in slice 1
      continue
    }
    counts.simulated++
    const bump = (side: "was" | "would", effect: string) => {
      if (effect === "allow" || effect === "escalate" || effect === "deny") totals[side][effect]++
    }
    bump("was", sim.was.effect)
    bump("would", sim.would.effect)
    if (e.ladder === "spend") {
      if (sim.was.effect === "allow") spend.was += r.amountUsd
      if (sim.would.effect === "allow") spend.would += r.amountUsd
    }
    if (sim.changed) {
      counts.changed++
      if (changes.length < MAX_CHANGES) {
        changes.push({
          id: r.id,
          at: r.createdAt.toISOString(),
          agent: nameOf.get(r.agentId),
          ladder: e.ladder,
          action: r.action,
          merchant: r.merchant,
          amount_usd: r.amountUsd,
          final_status: r.status, // what actually happened (incl. human approvals)
          was: { effect: sim.was.effect, code: sim.was.code ?? null },
          would: { effect: sim.would.effect, code: sim.would.code ?? null },
        })
      }
    }
  }

  const round2 = (n: number) => Math.round(n * 100) / 100
  return {
    state: "as_recorded" as const,
    note:
      "Each decision replays under the candidate with its recorded context; " +
      "budget counters are held as the engine saw them, so cascade effects are not modeled.",
    applied_fields: applied,
    ...(ignored.length > 0 ? { ignored_fields: ignored } : {}),
    totals,
    approved_spend_usd: { was: round2(spend.was), would: round2(spend.would) },
    counts,
    changes,
    ...(truncated ? { truncated: true, note_truncated: `only the first ${MAX_ROWS} decisions in range were simulated` } : {}),
  }
}
