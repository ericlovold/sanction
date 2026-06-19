import { NextRequest, NextResponse } from "next/server"
import { after } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { authenticateOwner } from "@/lib/ownerAuth"
import { generateWebhookSecret, deliverPing, isPublicHttpsUrl } from "@/lib/webhooks"

const KNOWN_EVENTS = ["escalation.created", "escalation.resolved", "budget.exhausted", "*"] as const

const schema = z.object({
  wallet_id: z.string(),
  url: z.string().url(),
  events: z.array(z.enum(KNOWN_EVENTS)).min(1).optional(),
})

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 })

  const { wallet_id, url, events } = parsed.data
  if (!isPublicHttpsUrl(url)) {
    return NextResponse.json({ error: "url must be a public https:// endpoint" }, { status: 400 })
  }

  const owner = await authenticateOwner(req, wallet_id)
  if (!owner.wallet) return NextResponse.json({ error: owner.error }, { status: owner.status })

  const secret = generateWebhookSecret()
  const hook = await db.webhook.create({
    data: { walletId: wallet_id, url, secret, events: events ?? ["escalation.created"] },
  })

  // Confirm the endpoint works without blocking the response.
  after(() => deliverPing(url, secret))

  return NextResponse.json(
    {
      id: hook.id,
      url: hook.url,
      events: hook.events,
      secret, // shown once — verify the x-sanction-signature header with it
      warning: "Store this signing secret now. It will not be shown again.",
    },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  )
}

export async function GET(req: NextRequest) {
  const walletId = req.nextUrl.searchParams.get("wallet_id")
  if (!walletId) return NextResponse.json({ error: "wallet_id required" }, { status: 400 })

  const owner = await authenticateOwner(req, walletId)
  if (!owner.wallet) return NextResponse.json({ error: owner.error }, { status: owner.status })

  const webhooks = await db.webhook.findMany({
    where: { walletId },
    select: { id: true, url: true, events: true, isActive: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  })
  return NextResponse.json({ webhooks })
}

export async function DELETE(req: NextRequest) {
  const walletId = req.nextUrl.searchParams.get("wallet_id")
  const id = req.nextUrl.searchParams.get("id")
  if (!walletId || !id) return NextResponse.json({ error: "wallet_id and id required" }, { status: 400 })

  const owner = await authenticateOwner(req, walletId)
  if (!owner.wallet) return NextResponse.json({ error: owner.error }, { status: owner.status })

  const hook = await db.webhook.findUnique({ where: { id } })
  if (!hook || hook.walletId !== walletId) return NextResponse.json({ error: "Webhook not found" }, { status: 404 })

  await db.webhook.delete({ where: { id } })
  return NextResponse.json({ deleted: id })
}
