import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { authenticateOwner } from "@/lib/ownerAuth"
import { rangeUtc } from "@/lib/reporting"
import { findPack } from "@/lib/policyPacks"
import { runSimulation } from "@/lib/simulationRun"

// Preview a pack before applying it (PACK-1): the roadmap promise made real —
// every pack ships with a simulation of what it would have done to your last
// 30 days. Same engine as POST /policy/simulate, same honesty envelope.
// Owner-only; read + compute, nothing persisted.

const bodySchema = z.object({
  wallet_id: z.string().min(1),
  from: z.string().optional(),
  to: z.string().optional(),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
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
  const walletId = parsed.data.wallet_id

  const owner = await authenticateOwner(req, walletId)
  if (!owner.wallet) {
    return NextResponse.json({ error: "Unauthorized: management key required" }, { status: 401 })
  }

  const pack = findPack(id)
  if (!pack) return NextResponse.json({ error: `Unknown pack '${id}'` }, { status: 404 })

  // Default window: the last 30 days, today inclusive.
  const today = new Date().toISOString().slice(0, 10)
  const monthAgo = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const from = parsed.data.from ?? monthAgo
  const to = parsed.data.to ?? today
  let start: Date, end: Date
  try {
    ;({ start, end } = rangeUtc(from, to))
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "invalid range" }, { status: 400 })
  }

  const report = await runSimulation(walletId, pack.policy, start, end)
  return NextResponse.json(
    {
      pack: { id: pack.id, name: pack.name, maturity: pack.maturity },
      wallet_id: walletId,
      from,
      to,
      ...report,
    },
    { headers: { "Cache-Control": "no-store" } },
  )
}
