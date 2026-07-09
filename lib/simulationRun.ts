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

export type SimMode = "as_recorded" | "sequential"

// Per-agent budget threaded across the sequential replay: the simulated
// approved spend so far this UTC day / calendar month. Reset at each boundary.
type AgentBudget = { dayKey: string; monthKey: string; dailySpentUsd: number; monthlySpentUsd: number }

const dayKeyOf = (d: Date) => d.toISOString().slice(0, 10) // UTC YYYY-MM-DD
const monthKeyOf = (d: Date) => d.toISOString().slice(0, 7) // UTC YYYY-MM

export async function runSimulation(
  walletId: string,
  policy: PolicyInput,
  start: Date,
  end: Date,
  mode: SimMode = "as_recorded",
) {
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

  // Sequential (SIM-2): thread each agent's simulated approved spend forward in
  // time so a would-denial doesn't count toward the running budget, freeing it
  // for a later request — the cascade SIM-1 deliberately doesn't model.
  const budgets = new Map<string, AgentBudget>()
  const budgetFor = (agentId: string, at: Date): AgentBudget => {
    const dk = dayKeyOf(at)
    const mk = monthKeyOf(at)
    let b = budgets.get(agentId)
    if (!b) {
      b = { dayKey: dk, monthKey: mk, dailySpentUsd: 0, monthlySpentUsd: 0 }
      budgets.set(agentId, b)
    }
    if (b.dayKey !== dk) { b.dayKey = dk; b.dailySpentUsd = 0 } // new UTC day resets the daily counter
    if (b.monthKey !== mk) { b.monthKey = mk; b.monthlySpentUsd = 0 }
    return b
  }

  for (const r of considered) {
    const e = r.decisionContextJson
    if (!isDecisionEvidence(e)) {
      counts.unreplayable++ // pre-EVID-1 rows have no stored context — never guess at one
      continue
    }
    // Sequential threads the running budget into spend evaluation; capability
    // rows carry no budget so the override is inert for them.
    const budget = mode === "sequential" && e.ladder === "spend" ? budgetFor(r.agentId, r.createdAt) : undefined
    let sim: ReturnType<typeof simulateEvidence>
    try {
      sim = simulateEvidence(e, policy, budget)
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
    // Sequential accrual: only a would-APPROVED spend consumes the threaded
    // budget for the requests that follow it.
    if (budget && e.ladder === "spend" && sim.would.effect === "allow") {
      budget.dailySpentUsd += r.amountUsd
      budget.monthlySpentUsd += r.amountUsd
    }
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
    state: mode,
    note:
      mode === "sequential"
        ? "Decisions replay in chronological order with each agent's approved spend threaded forward " +
          "(daily/monthly counters reset at UTC boundaries), so an early would-denial frees budget for a " +
          "later request — the cascade the as_recorded mode holds constant. Subtree/pool caps are not yet threaded."
        : "Each decision replays under the candidate with its recorded context; " +
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
