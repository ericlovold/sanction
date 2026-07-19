import "server-only"
import { db } from "@/lib/db"

// One pending escalation from the public demo wallet, shaped for a human-facing
// card. Shared by the demo dashboard and the landing hero so both show the same
// real, live decision. Prefers a money decision ("$450 to Rule 26 Experts LLC")
// over a bare tool toggle — it reads as a real judgment call, which is the point.
export type DemoEscalation = {
  id: string
  agent: string
  actionType: string
  reason: string | null
  merchant: string | null
  amount: number | null
}

export async function getDemoEscalation(): Promise<DemoEscalation | null> {
  const demoWalletId = process.env.SANCTION_WALLET_ID
  if (!demoWalletId) return null

  const rows = await db.pendingApproval.findMany({
    where: { walletId: demoWalletId, status: "pending" },
    orderBy: { createdAt: "asc" },
    select: { id: true, agentId: true, actionType: true, reason: true, resourceJson: true },
    take: 8,
  })
  if (rows.length === 0) return null

  const agentIds = [...new Set(rows.map((r) => r.agentId))]
  const agents = await db.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true } })
  const nameOf = new Map(agents.map((a) => [a.id, a.name]))

  const shaped: DemoEscalation[] = rows.map((p) => {
    const res = (p.resourceJson ?? {}) as Record<string, unknown>
    const amount =
      typeof res.amount_usd === "number" ? res.amount_usd : typeof res.amountUsd === "number" ? res.amountUsd : null
    const merchant =
      typeof res.merchant === "string" ? res.merchant : typeof res.resource === "string" ? res.resource : null
    return { id: p.id, agent: nameOf.get(p.agentId) ?? "agent", actionType: p.actionType, reason: p.reason, merchant, amount }
  })

  // Prefer a money decision for the hero; fall back to the oldest pending.
  return shaped.find((s) => s.amount != null && s.merchant != null) ?? shaped[0]
}
