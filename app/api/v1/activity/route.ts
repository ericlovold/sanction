import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { authenticateAgent } from "@/lib/auth"

export const dynamic = "force-dynamic"

const noStore = { "cache-control": "no-store" }

// Lightweight "has this agent done anything yet?" probe. The onboarding screen
// polls it (with the agent's own x-api-key) to flip a "first call received" state
// once a real call has been metered through the gateway — closing the loop without
// a dashboard refresh.
export async function GET(req: NextRequest) {
  const { agent, error } = await authenticateAgent(req)
  if (!agent) return NextResponse.json({ error }, { status: 401, headers: noStore })

  const last = await db.tokenLog.findFirst({
    where: { agentId: agent.id, taskLabel: { startsWith: "gateway:" } },
    orderBy: { createdAt: "desc" },
    select: { model: true, tokensIn: true, tokensOut: true, costUsd: true, createdAt: true },
  })

  return NextResponse.json({ firstCall: !!last, last }, { headers: noStore })
}
