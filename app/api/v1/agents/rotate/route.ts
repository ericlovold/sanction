import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { generateApiKey } from "@/lib/apiKey"
import { authenticateOwner } from "@/lib/ownerAuth"

const schema = z.object({
  wallet_id: z.string(),
  agent_id: z.string(),
  // Pass the seat along: optionally set the new holder in the same motion.
  // History, budgets, and clearance stay with the seat; only the key changes.
  holder: z.string().min(1).max(120).optional(),
})

// SEC-6: rotate an agent's API key (management plane). The old key stops working
// immediately (only the hash is stored, and we overwrite it); the new key is
// returned once and is never retrievable again. To revoke without re-issuing,
// PATCH /api/v1/agents with { active: false }.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 })
  }
  const { wallet_id, agent_id, holder } = parsed.data

  const owner = await authenticateOwner(req, wallet_id)
  if (!owner.wallet) return NextResponse.json({ error: owner.error }, { status: owner.status })

  const agent = await db.agent.findUnique({ where: { id: agent_id } })
  if (!agent || agent.walletId !== wallet_id) {
    return NextResponse.json({ error: "Agent not found in this wallet" }, { status: 404 })
  }

  const { raw, hash, prefix } = generateApiKey()
  const updated = await db.agent.update({
    where: { id: agent_id },
    data: { apiKeyHash: hash, apiKeyPrefix: prefix, ...(holder !== undefined ? { holder } : {}) },
  })

  return NextResponse.json(
    {
      id: agent.id,
      name: agent.name,
      holder: updated.holder,
      api_key: raw,
      api_key_prefix: prefix,
      wallet_id,
      warning: "Old key revoked. Store this new key now — it will not be shown again.",
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  )
}
