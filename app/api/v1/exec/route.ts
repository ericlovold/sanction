import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { authenticateAgent } from "@/lib/auth"
import { issueExecutionJWT } from "@/lib/jwt"
import { randomBytes } from "crypto"

const schema = z.object({
  scope: z.array(z.string()).min(1),   // credential labels this execution needs
  budget_usd: z.number().positive(),
  ttl_seconds: z.number().int().min(60).max(3600).default(900),
  container_id: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const { agent, error } = await authenticateAgent(req)
  if (!agent) return NextResponse.json({ error }, { status: 401 })

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 })
  }

  const { scope, budget_usd, ttl_seconds, container_id } = parsed.data

  // Get agent clearance level
  const clearance = await db.agentClearance.findUnique({ where: { agentId: agent.id } })
  const clearanceLevel = clearance?.level ?? 1

  // Verify requested credential labels exist and agent is allowed to access them
  const credentials = await db.credentialVault.findMany({
    where: {
      walletId: agent.walletId,
      label: { in: scope },
    },
  })

  const denied = scope.filter(
    (s) => !credentials.find(
      (c) => c.label === s && (c.allowedAgentIds.length === 0 || c.allowedAgentIds.includes(agent.id))
    )
  )
  if (denied.length > 0) {
    return NextResponse.json({ error: "Agent not authorized for credentials", denied }, { status: 403 })
  }

  const jti = randomBytes(16).toString("hex")
  const expiresAt = new Date(Date.now() + ttl_seconds * 1000)

  // Pass the same jti used for the ExecutionToken row below so /inject can find
  // it (it looks up by the JWT's jti).
  const jwt = await issueExecutionJWT({
    wallet: agent.walletId,
    agent: agent.id,
    clearance: clearanceLevel,
    scope,
    budget_usd,
  }, ttl_seconds, jti)

  await db.executionToken.create({
    data: {
      id: jti,
      agentId: agent.id,
      walletId: agent.walletId,
      scope,
      budgetUsd: budget_usd,
      clearance: clearanceLevel,
      expiresAt,
      containerId: container_id,
    },
  })

  return NextResponse.json(
    {
      jwt,
      jti,
      expires_at: expiresAt.toISOString(),
      clearance: clearanceLevel,
      scope,
      budget_usd,
      ttl_seconds,
    },
    // The JWT is a bearer secret — keep it out of any cache (SEC-13).
    { headers: { "Cache-Control": "no-store" } },
  )
}
