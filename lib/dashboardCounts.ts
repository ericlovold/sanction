type AgentLifecycle = { isActive: boolean; expiresAt?: Date | string | null }

// Disabled takes precedence over expired, matching the key's authentication
// checks. These states partition the roster, so totals never double count.
export function agentState(agent: AgentLifecycle, now = new Date()): "active" | "expired" | "revoked" {
  if (!agent.isActive) return "revoked"
  if (agent.expiresAt && new Date(agent.expiresAt) <= now) return "expired"
  return "active"
}

export function agentExpiringSoon(agent: AgentLifecycle, now = new Date()): boolean {
  return agentState(agent, now) === "active" && !!agent.expiresAt &&
    new Date(agent.expiresAt).getTime() - now.getTime() <= 7 * 24 * 60 * 60 * 1000
}

// Read-only view of requests a person can still decide. Loading an overview
// must not settle timeout policy or mint grants as a side effect.
export function waitingApprovalWhere(walletIds: string[], now = new Date()) {
  return {
    walletId: { in: walletIds },
    status: "pending" as const,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  }
}
