import { db } from "./db"
import type { JWTPayload } from "jose"

/** Rechecked on every request; tokens never choose their wallet or agent. */
export async function mcpConnectionIdentity(claims: JWTPayload) {
  if (typeof claims.sanction_connection_id !== "string" || typeof claims.sub !== "string" || typeof claims.client_id !== "string") return null
  const connection = await db.mcpOAuthConnection.findFirst({
    where: { id: claims.sanction_connection_id, userId: claims.sub, clientId: claims.client_id, revokedAt: null },
  })
  if (!connection) return null
  const wallet = await db.wallet.findFirst({ where: { id: connection.walletId, userId: connection.userId }, select: { id: true } })
  if (!wallet) {
    const membership = await db.walletMember.findFirst({
      where: { walletId: connection.walletId, userId: connection.userId, status: "active", role: { in: ["owner", "admin"] } },
      select: { id: true },
    })
    if (!membership) return null
  }
  const agent = await db.agent.findFirst({
    where: { id: connection.agentId, walletId: connection.walletId, isActive: true },
    select: { id: true, expiresAt: true },
  })
  if (!agent || (agent.expiresAt && agent.expiresAt <= new Date())) return null
  return { agentId: connection.agentId, walletId: connection.walletId }
}
