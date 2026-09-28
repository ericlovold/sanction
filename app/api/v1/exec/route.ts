import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { authenticateAgent } from "@/lib/auth"
import { hashApiKey } from "@/lib/apiKey"
import { frozenNote, walletFreezeState } from "@/lib/freeze"
import { issueExecutionJWT } from "@/lib/jwt"
import { withTenant } from "@/lib/rls"
import { isReservedVaultLabel } from "@/lib/providers"

const schema = z.object({
  scope: z.array(z.string()).min(1),   // credential labels this execution needs
  budget_usd: z.number().positive(),
  ttl_seconds: z.number().int().min(60).max(3600).default(900),
  container_id: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const { agent, error } = await authenticateAgent(req)
  if (!agent) return NextResponse.json({ error }, { status: 401 })

  // KILL-1: a frozen wallet (or ancestor) pauses every data-plane action.
  const freeze = await walletFreezeState(db, agent.walletId)
  if (freeze.frozen) {
    return NextResponse.json({ error: frozenNote(freeze), code: "WALLET_FROZEN" }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 })
  }

  const { scope, budget_usd, ttl_seconds, container_id } = parsed.data

  // Reserved labels (`provider:*` gateway keys, `mcp:*` broker configs) are
  // server-side only. Refused here, before any lookup, regardless of the row's
  // allow-list or the agent's clearance — the invariant the Providers page
  // states ("never injectable by agents") must not depend on row data.
  const reserved = scope.filter(isReservedVaultLabel)
  if (reserved.length > 0) {
    return NextResponse.json(
      { error: "Reserved credential labels are server-side only and cannot be injected", denied: reserved },
      { status: 403 },
    )
  }

  // Get agent clearance level (RLS-scoped to the agent's wallet)
  const clearance = await withTenant(agent.walletId, (tx) =>
    tx.agentClearance.findUnique({ where: { agentId: agent.id } }),
  )
  const clearanceLevel = clearance?.level ?? 1

  // Verify requested credential labels exist and agent is allowed to access them.
  // RLS-scoped to the agent's wallet (SEC-3) — the DB will not return another
  // tenant's credentials even if the where clause were wrong.
  const credentials = await withTenant(agent.walletId, (tx) =>
    tx.credentialVault.findMany({
      where: {
        walletId: agent.walletId,
        label: { in: scope },
      },
    }),
  )

  const denied = scope.filter(
    (s) => !credentials.find(
      (c) =>
        c.label === s &&
        (c.allowedAgentIds.length === 0 || c.allowedAgentIds.includes(agent.id)) &&
        clearanceLevel >= c.minClearance
    )
  )
  if (denied.length > 0) {
    return NextResponse.json({ error: "Agent not authorized for credentials (check allow-list and clearance)", denied }, { status: 403 })
  }

  const expiresAt = new Date(Date.now() + ttl_seconds * 1000)

  // Issue under the agent's row lock. Rotation, deactivation, and pool moves
  // UPDATE this row (taking the same lock) and revoke active tokens in one
  // transaction, so re-checking the presented key here means a kill switch that
  // committed after authenticateAgent can never leave a freshly minted token.
  const presentedHash = hashApiKey(req.headers.get("x-api-key") ?? "")
  const issued = await db.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<
      Array<{ apiKeyHash: string; isActive: boolean; expiresAt: Date | null; walletId: string }>
    >`SELECT "apiKeyHash", "isActive", "expiresAt", "walletId" FROM "Agent" WHERE "id" = ${agent.id} FOR UPDATE`
    if (
      !row ||
      row.apiKeyHash !== presentedHash ||
      !row.isActive ||
      (row.expiresAt && row.expiresAt <= new Date()) ||
      row.walletId !== agent.walletId
    ) {
      return null
    }

    const { jwt, jti } = await issueExecutionJWT({
      wallet: agent.walletId,
      agent: agent.id,
      clearance: clearanceLevel,
      scope,
      budget_usd,
    }, ttl_seconds)

    await tx.executionToken.create({
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
    return { jwt, jti }
  })
  if (!issued) return NextResponse.json({ error: "Agent key is no longer valid" }, { status: 401 })
  const { jwt, jti } = issued

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
