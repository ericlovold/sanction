import { NextRequest } from "next/server"
import { db } from "./db"
import { hashApiKey } from "./apiKey"

export async function authenticateAgent(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key")
  if (!apiKey) return { agent: null, error: "Missing x-api-key header" }

  const hash = hashApiKey(apiKey)
  const agent = await db.agent.findUnique({
    where: { apiKeyHash: hash },
    include: { wallet: { include: { policy: true } } },
  })

  if (!agent) return { agent: null, error: "Invalid API key" }
  if (!agent.isActive) return { agent: null, error: "Agent is inactive" }
  // Seat expiry (contractor auto-shutoff): past expiresAt the key fails closed
  // everywhere, no deactivation step required.
  if (agent.expiresAt && agent.expiresAt <= new Date()) {
    return { agent: null, error: "Agent key expired" }
  }

  // Best-effort "last used" stamp for the console, throttled to ~5 min so it's
  // not a write on every request. Fire-and-forget — never block or fail auth.
  const STALE_MS = 5 * 60_000
  if (!agent.lastUsedAt || Date.now() - agent.lastUsedAt.getTime() > STALE_MS) {
    void db.agent.update({ where: { id: agent.id }, data: { lastUsedAt: new Date() } }).catch(() => {})
  }

  return { agent, error: null }
}
