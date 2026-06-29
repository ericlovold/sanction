import { NextRequest, NextResponse } from "next/server"
import { timingSafeEqual } from "crypto"
import { z } from "zod"
import { db } from "@/lib/db"

export const dynamic = "force-dynamic"

/**
 * Curate the public feedback board. Owner-only, guarded by SANCTION_ADMIN_SECRET
 * (x-admin-secret header).
 *   GET            → all ideas incl. unpublished (the moderation queue)
 *   PATCH {id,...} → publish/unpublish, set status, or delete an idea
 * New submissions arrive unpublished; nothing is public until you publish it.
 */
const STATUSES = ["open", "planned", "in_progress", "shipped", "declined"] as const

const patchSchema = z.object({
  id: z.string().cuid(),
  isPublished: z.boolean().optional(),
  status: z.enum(STATUSES).optional(),
  delete: z.boolean().optional(),
})

export async function GET(req: NextRequest) {
  const guard = authorize(req)
  if (guard) return guard

  const ideas = await db.idea.findMany({
    orderBy: [{ isPublished: "asc" }, { voteCount: "desc" }, { createdAt: "desc" }],
  })
  return NextResponse.json({ count: ideas.length, ideas }, { headers: { "Cache-Control": "no-store" } })
}

export async function PATCH(req: NextRequest) {
  const guard = authorize(req)
  if (guard) return guard

  const body = await req.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 })
  }
  const { id, isPublished, status, delete: del } = parsed.data

  if (del) {
    await db.idea.delete({ where: { id } })
    return NextResponse.json({ ok: true, deleted: id }, { headers: { "Cache-Control": "no-store" } })
  }

  const data: { isPublished?: boolean; status?: string } = {}
  if (isPublished !== undefined) data.isPublished = isPublished
  if (status !== undefined) data.status = status
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 })
  }

  const idea = await db.idea.update({ where: { id }, data })
  return NextResponse.json({ ok: true, idea }, { headers: { "Cache-Control": "no-store" } })
}

function authorize(req: NextRequest): NextResponse | null {
  const adminSecret = process.env.SANCTION_ADMIN_SECRET
  if (!adminSecret) {
    return NextResponse.json({ error: "Disabled: SANCTION_ADMIN_SECRET not configured" }, { status: 503 })
  }
  if (!constantTimeEqual(req.headers.get("x-admin-secret") ?? "", adminSecret)) {
    return NextResponse.json({ error: "Invalid admin secret" }, { status: 401 })
  }
  return null
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}
