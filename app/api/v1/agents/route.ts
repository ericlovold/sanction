import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { generateApiKey } from "@/lib/apiKey"

const schema = z.object({
  wallet_id: z.string(),
  name: z.string().min(1).max(64),
})

// Register a new agent and return its API key (shown once)
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 })
  }

  const { wallet_id, name } = parsed.data

  const wallet = await db.wallet.findUnique({ where: { id: wallet_id } })
  if (!wallet) return NextResponse.json({ error: "Wallet not found" }, { status: 404 })

  const { raw, hash, prefix } = generateApiKey()

  const agent = await db.agent.create({
    data: { walletId: wallet_id, name, apiKeyHash: hash, apiKeyPrefix: prefix },
  })

  // raw key returned once — never stored, never retrievable again
  return NextResponse.json({
    id: agent.id,
    name: agent.name,
    api_key: raw,
    api_key_prefix: prefix,
    wallet_id,
    created_at: agent.createdAt,
    warning: "Store this API key now. It will not be shown again.",
  }, { status: 201 })
}

export async function GET(req: NextRequest) {
  const walletId = req.nextUrl.searchParams.get("wallet_id")
  if (!walletId) return NextResponse.json({ error: "wallet_id required" }, { status: 400 })

  const agents = await db.agent.findMany({
    where: { walletId },
    select: { id: true, name: true, apiKeyPrefix: true, isActive: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json({ agents })
}
