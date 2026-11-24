import { db } from "./db"
import { hasRole, type WalletRole } from "./roles"
import { withTenant } from "./rls"
import type { AgentBlockAccount } from "./agentConnectBlock"

const APPROVAL_EVENTS = ["approval.created", "escalation.created"]

// Display facts for the connection guide's agent blocks. Names and two
// booleans only: nothing here identifies a row or authenticates anything.
export async function agentBlockAccount(wallet: { id: string; name: string }, role: WalletRole, now = new Date()): Promise<AgentBlockAccount> {
  const [agents, slack] = await Promise.all([
    // Same filter and order as the consent screen's seat list.
    db.agent.findMany({
      where: { walletId: wallet.id, isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      select: { name: true }, orderBy: { name: "asc" },
    }),
    withTenant(wallet.id, (tx) => tx.slackInstall.count({
      where: { walletId: wallet.id, revokedAt: null, events: { hasSome: APPROVAL_EVENTS } },
    })).catch(() => 0),
  ])
  return { wallet: wallet.name, seats: agents.map(agent => agent.name), admin: hasRole(role, "admin"), slack: slack > 0 }
}
