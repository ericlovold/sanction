import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { authenticateOwner } from "@/lib/ownerAuth"
import { rangeUtc } from "@/lib/reporting"
import { policyInputSchema } from "@/lib/policy"
import { partitionFields } from "@/lib/simulate"
import { runSimulation } from "@/lib/simulationRun"

// Retro-simulation (SIM-1): POST a candidate policy (partial, dollars — the
// same shape as the policy update) and a range; every stored decision in the
// window replays under the overlay and the response reports what flips.
// Owner-only: policy experimentation is a management-plane activity. Purely
// read + compute — nothing is persisted, debited, or escalated. The engine
// itself lives in lib/simulationRun.ts, shared with the policy pack preview.

const bodySchema = z.object({
  wallet_id: z.string().min(1),
  from: z.string().optional(),
  to: z.string().optional(),
  // as_recorded (default): each decision replays with its recorded budget state.
  // sequential (SIM-2): replays in order, threading approved spend forward so an
  // early denial frees budget downstream.
  mode: z.enum(["as_recorded", "sequential"]).optional(),
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

  const report = await runSimulation(walletId, policy, start, end, parsed.data.mode ?? "as_recorded")
  return NextResponse.json(
    { wallet_id: walletId, from, to, ...report },
    { headers: { "Cache-Control": "no-store" } },
  )
}
