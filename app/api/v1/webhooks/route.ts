import { NextRequest, NextResponse } from "next/server"
import { after } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { authenticateOwner } from "@/lib/ownerAuth"
import { generateWebhookSecret, deliverPing, isPublicHttpsUrl, KNOWN_EVENTS, DEFAULT_EVENTS } from "@/lib/webhooks"

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
    data: { walletId: wallet_id, url, secret, events: events ?? DEFAULT_EVENTS },
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

const patchSchema = z.object({
  wallet_id: z.string(),
  id: z.string(),
  url: z.string().url().optional(),
  events: z.array(z.enum(KNOWN_EVENTS)).min(1).optional(),
  active: z.boolean().optional(),
})

// Edit a webhook in place: pause/resume (active), change url or events — no need
// to delete and re-create (which would mint a new signing secret).
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 })

  const { wallet_id, id, url, events, active } = parsed.data
  if (url !== undefined && !isPublicHttpsUrl(url)) {
    return NextResponse.json({ error: "url must be a public https:// endpoint" }, { status: 400 })
  }

  const owner = await authenticateOwner(req, wallet_id)
  if (!owner.wallet) return NextResponse.json({ error: owner.error }, { status: owner.status })

  const hook = await db.webhook.findUnique({ where: { id } })
  if (!hook || hook.walletId !== wallet_id) return NextResponse.json({ error: "Webhook not found" }, { status: 404 })

  const updated = await db.webhook.update({
    where: { id },
    data: {
      ...(url !== undefined ? { url } : {}),
      ...(events !== undefined ? { events } : {}),
      ...(active !== undefined ? { isActive: active } : {}),
    },
    select: { id: true, url: true, events: true, isActive: true, createdAt: true },
  })
  return NextResponse.json({ webhook: updated }, { headers: { "Cache-Control": "no-store" } })
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
