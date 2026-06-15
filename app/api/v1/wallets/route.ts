import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { generateManagementKey } from "@/lib/apiKey"

const schema = z.object({
  name: z.string().min(1).max(64),
  owner_email: z.string().email(),
})

// Sign-up entry point — intentionally unauthenticated. Returns a management
// key (shown once) that gates every other management-plane endpoint.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 })
  }

  const { name, owner_email } = parsed.data
  const mgmt = generateManagementKey()

  const wallet = await db.wallet.create({
    data: {
      name,
      ownerEmail: owner_email,
      mgmtKeyHash: mgmt.hash,
      mgmtKeyPrefix: mgmt.prefix,
      policy: {
        create: {}, // defaults from schema
      },
    },
    include: { policy: true },
  })

  return NextResponse.json({
    id: wallet.id,
    name: wallet.name,
    owner_email: wallet.ownerEmail,
    management_key: mgmt.raw,
    management_key_prefix: mgmt.prefix,
    warning: "Store this management key now. It will not be shown again. Required (x-mgmt-key) to manage this wallet.",
    created_at: wallet.createdAt,
  }, { status: 201 })
}
