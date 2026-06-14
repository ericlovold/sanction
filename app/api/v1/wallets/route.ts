import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"

const schema = z.object({
  name: z.string().min(1).max(64),
  owner_email: z.string().email(),
})

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 })
  }

  const { name, owner_email } = parsed.data

  const wallet = await db.wallet.create({
    data: {
      name,
      ownerEmail: owner_email,
      policy: {
        create: {}, // defaults from schema
      },
    },
    include: { policy: true },
  })

  return NextResponse.json({ id: wallet.id, name: wallet.name, owner_email: wallet.ownerEmail, created_at: wallet.createdAt }, { status: 201 })
}
