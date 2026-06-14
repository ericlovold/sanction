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

  return { agent, error: null }
}
