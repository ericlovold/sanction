import { db } from "./db"
import { mcpOAuthEnabled } from "./mcpOAuthProvider"

/** Saved OAuth access for onboarding; this does not prove client connectivity. */
export async function hasActiveMcpConnection(walletId: string): Promise<boolean> {
  if (!mcpOAuthEnabled()) return false

  const wallet = await db.wallet.findFirst({
    where: { id: walletId },
    select: {
      userId: true,
      members: {
        where: { walletId, status: "active", role: { in: ["owner", "admin"] } },
        select: { userId: true },
      },
    },
  })
  if (!wallet) return false

  const userIds = [...new Set([wallet.userId, ...wallet.members.map((member) => member.userId)])]
    .filter((userId): userId is string => userId !== null)
  if (userIds.length === 0) return false

  const connection = await db.mcpOAuthConnection.findFirst({
    where: {
      walletId,
      userId: { in: userIds },
      revokedAt: null,
      agent: {
        walletId,
        isActive: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    },
    select: { id: true },
  })
  return connection !== null
}
