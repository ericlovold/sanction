import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { authenticateOwner } from "@/lib/ownerAuth"
import { rangeUtc } from "@/lib/reporting"
import { policyInputSchema } from "@/lib/policy"
import { isDecisionEvidence } from "@/lib/evidence"
import { simulateEvidence, partitionFields } from "@/lib/simulate"

// Retro-simulation (SIM-1): POST a candidate policy (partial, dollars — the
// same shape as the policy update) and a range; every stored decision in the
// window replays under the overlay and the response reports what flips.
// Owner-only: policy experimentation is a management-plane activity. Purely
// read + compute — nothing is persisted, debited, or escalated.

const MAX_ROWS = 5000
const MAX_CHANGES = 100

const bodySchema = z.object({
  wallet_id: z.string().min(1),
  from: z.string().optional(),
  to: z.string().optional(),
  policy: policyInputSchema,
})

export async function POST(req: NextRequest) {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 })
  }
  const { wallet_id: walletId, policy } = parsed.data

  const owner = await authenticateOwner(req, walletId)
  if (!owner.wallet) {
    return NextResponse.json({ error: "Unauthorized: management key required" }, { status: 401 })
  }

  const { applied, ignored } = partitionFields(policy)
  if (applied.length === 0) {
    return NextResponse.json(
      { error: "No simulatable policy fields provided", ignored_fields: ignored },
      { status: 400 },
    )
  }

  const today = new Date().toISOString().slice(0, 10)
  const weekAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const from = parsed.data.from ?? weekAgo
  const to = parsed.data.to ?? today
  let start: Date, end: Date
  try {
    ;({ start, end } = rangeUtc(from, to))
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "invalid range" }, { status: 400 })
  }

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
  return NextResponse.json(
    {
      wallet_id: walletId,
      from,
      to,
      state: "as_recorded",
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
    },
    { headers: { "Cache-Control": "no-store" } },
  )
}
