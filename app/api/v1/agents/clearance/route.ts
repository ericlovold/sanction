import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { Prisma } from "@/lib/generated/prisma/client"
import { authenticateOwner } from "@/lib/ownerAuth"
import { INDUSTRIES, MIN_CLEARANCE, MAX_CLEARANCE } from "@/lib/clearance"

// Assign or update an agent's clearance (level 1-5 + industry domain).
// Management-plane: requires the wallet's management key (x-mgmt-key).
// Writes the existing AgentClearance model; upserts on the unique agentId.
const schema = z.object({
  wallet_id: z.string(),
  agent_id: z.string(),
  level: z.number().int().min(MIN_CLEARANCE).max(MAX_CLEARANCE),
  industry: z.enum(INDUSTRIES).default("general"),
  expires_at: z.string().datetime().optional(),
  restrictions: z.record(z.string(), z.unknown()).optional(),
})

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 })
  }

  const { wallet_id, agent_id, level, industry, expires_at, restrictions } = parsed.data

  const owner = await authenticateOwner(req, wallet_id)
  if (!owner.wallet) return NextResponse.json({ error: owner.error }, { status: owner.status })

  // The agent must belong to this wallet — never grant clearance on another
  // tenant's agent via a known agent id.
  const agent = await db.agent.findFirst({ where: { id: agent_id, walletId: wallet_id } })
  if (!agent) {
    return NextResponse.json({ error: "Agent not found in this wallet" }, { status: 404 })
  }

  const expiresAt = expires_at ? new Date(expires_at) : null
  const restrictionsJson: Prisma.InputJsonValue | undefined =
    restrictions === undefined ? undefined : (restrictions as Prisma.InputJsonValue)

  const clearance = await db.agentClearance.upsert({
    where: { agentId: agent_id },
    update: { level, industry, expiresAt, restrictions: restrictionsJson },
    create: {
      walletId: wallet_id,
      agentId: agent_id,
      level,
      industry,
      expiresAt,
      restrictions: restrictionsJson,
    },
  })

  return NextResponse.json({
    agent_id: clearance.agentId,
    wallet_id: clearance.walletId,
    level: clearance.level,
    industry: clearance.industry,
    granted_at: clearance.grantedAt,
    expires_at: clearance.expiresAt,
    restrictions: clearance.restrictions ?? undefined,
  })
}
