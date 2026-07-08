import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { authenticateAgent } from "@/lib/auth"
import { authenticateOwner } from "@/lib/ownerAuth"
import { logger } from "@/lib/log"
import { walletWindowOutcomes, walletWindowSpendUsd, windowStart } from "@/lib/outcomes"

const log = logger("v1/outcomes")

// Outcomes (CPO-1): the operator's systems report the business results a
// wallet's spend answers to — an enrollment, a booking, a signed engagement.
// Sanction never invents outcomes; it only counts what the operator attests,
// and the cost-per-outcome ceiling governs spend against that count.

const schema = z.object({
  kind: z.string().trim().toLowerCase().min(1).max(40), // "enrollment", "booking", …
  value_usd: z.number().nonnegative().max(10_000_000).optional(),
  play: z.string().trim().min(1).max(80).optional(), // campaign/play tag for reporting
  dedupe_key: z.string().trim().min(1).max(120).optional(), // idempotent reporting
  occurred_at: z.string().datetime().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

// Record an outcome (agent data plane — the reporting integration holds an agent key).
export async function POST(req: NextRequest) {
  const { agent, error } = await authenticateAgent(req)
  if (!agent) {
    log.warn("auth failed", { error })
    return NextResponse.json({ error }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 })
  }
  const { kind, value_usd, play, dedupe_key, occurred_at, metadata } = parsed.data

  // Idempotent replay: same dedupe_key returns the original event, never a double count.
  if (dedupe_key) {
    const existing = await db.outcomeEvent.findUnique({
      where: { walletId_dedupeKey: { walletId: agent.walletId, dedupeKey: dedupe_key } },
    })
    if (existing) {
      return NextResponse.json({ id: existing.id, recorded: true, deduped: true, kind: existing.kind })
    }
  }

  try {
    const event = await db.outcomeEvent.create({
      data: {
        walletId: agent.walletId,
        agentId: agent.id,
        kind,
        valueUsd: value_usd,
        playLabel: play,
        dedupeKey: dedupe_key,
        metadataJson: (metadata ?? undefined) as never,
        occurredAt: occurred_at ? new Date(occurred_at) : undefined,
      },
    })
    return NextResponse.json({ id: event.id, recorded: true, deduped: false, kind: event.kind }, { status: 201 })
  } catch (e: unknown) {
    // Concurrent duplicate on (walletId, dedupeKey) — return the winner.
    if (dedupe_key && typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "P2002") {
      const existing = await db.outcomeEvent.findUnique({
        where: { walletId_dedupeKey: { walletId: agent.walletId, dedupeKey: dedupe_key } },
      })
      if (existing) return NextResponse.json({ id: existing.id, recorded: true, deduped: true, kind: existing.kind })
    }
    throw e
  }
}

// Windowed cost-per-outcome summary (owner only) — the CFO read.
export async function GET(req: NextRequest) {
  const walletId = req.nextUrl.searchParams.get("wallet_id")
  if (!walletId) return NextResponse.json({ error: "wallet_id required" }, { status: 400 })

  const owner = await authenticateOwner(req, walletId)
  if (!owner.wallet) return NextResponse.json({ error: owner.error }, { status: owner.status })

  const kind = (req.nextUrl.searchParams.get("kind") ?? "").trim().toLowerCase()
  if (!kind) return NextResponse.json({ error: "kind required" }, { status: 400 })
  const windowDays = Math.min(365, Math.max(1, Number(req.nextUrl.searchParams.get("window_days") ?? 30) || 30))

  const since = windowStart(windowDays)
  const [outcomes, spendUsd, policy] = await Promise.all([
    walletWindowOutcomes(db, walletId, kind, since),
    walletWindowSpendUsd(db, walletId, since),
    db.policy.findUnique({
      where: { walletId },
      select: { outcomeKind: true, costPerOutcomeCeilingUsd: true, costPerOutcomeMinOutcomes: true },
    }),
  ])

  const costPerOutcome = outcomes > 0 ? Math.round((spendUsd / outcomes) * 100) / 100 : null
  const ceilingUsd =
    policy?.outcomeKind === kind && policy.costPerOutcomeCeilingUsd != null ? policy.costPerOutcomeCeilingUsd / 100 : null

  return NextResponse.json({
    wallet_id: walletId,
    kind,
    window_days: windowDays,
    outcomes,
    window_spend_usd: Math.round(spendUsd * 100) / 100,
    cost_per_outcome_usd: costPerOutcome,
    ceiling_usd: ceilingUsd,
    over_ceiling: ceilingUsd !== null && costPerOutcome !== null ? costPerOutcome > ceilingUsd : false,
    governed: ceilingUsd !== null && outcomes >= (policy?.costPerOutcomeMinOutcomes ?? 0),
  })
}
