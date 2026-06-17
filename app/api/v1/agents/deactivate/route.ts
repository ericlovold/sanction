import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { authenticateOwner } from "@/lib/ownerAuth"

const schema = z.object({
  wallet_id: z.string(),
  agent_id: z.string(),
  // Default false = deactivate. Pass true to re-activate a key.
  active: z.boolean().optional(),
})

// Deactivate (or re-activate) an agent's API key. Management-plane: requires the
// wallet's management key. Used for key rotation — a deactivated agent fails
// authentication immediately (see authenticateAgent). Idempotent.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 })
  }

  const { wallet_id, agent_id, active = false } = parsed.data

  const owner = await authenticateOwner(req, wallet_id)
  if (!owner.wallet) return NextResponse.json({ error: owner.error }, { status: owner.status })

  // Scope the agent to this wallet so an owner can't toggle another tenant's agent.
  const agent = await db.agent.findFirst({ where: { id: agent_id, walletId: wallet_id } })
  if (!agent) return NextResponse.json({ error: "Agent not found in this wallet" }, { status: 404 })

  const updated = await db.agent.update({
    where: { id: agent.id },
    data: { isActive: active },
    select: { id: true, name: true, apiKeyPrefix: true, isActive: true },
  })

  return NextResponse.json({
    id: updated.id,
    name: updated.name,
    api_key_prefix: updated.apiKeyPrefix,
    is_active: updated.isActive,
  })
}
