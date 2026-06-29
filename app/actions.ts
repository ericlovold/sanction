"use server"

import { createHash } from "crypto"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { db } from "@/lib/db"
import { rateLimit, ipFromHeaders } from "@/lib/rateLimit"

export type LeadState = { ok: boolean; error: string }

// Awareness-stage lead capture. Stores the email in our own DB (we own the list).
// Idempotent: a repeat email is a no-op success, never an error or a leak.
export async function captureLeadAction(_prev: LeadState, form: FormData): Promise<LeadState> {
  const rl = await rateLimit("lead_capture", ipFromHeaders(await headers()), 10, 600)
  if (!rl.ok) return { ok: false, error: "Too many attempts. Try again in a few minutes." }

  const parsed = z.string().trim().email().max(200).safeParse(form.get("email"))
  if (!parsed.success) return { ok: false, error: "Enter a valid email." }
  const email = parsed.data.toLowerCase()
  const source = String(form.get("source") ?? "landing").slice(0, 40)

  try {
    await db.lead.create({ data: { email, source } })
  } catch (e: unknown) {
    // Unique violation = already on the list. Treat as success.
    const code = typeof e === "object" && e !== null && "code" in e ? (e as { code?: string }).code : undefined
    if (code !== "P2002") throw e
  }

  return { ok: true, error: "" }
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "P2002"
}

// Mirror a captured email into the Lead list (idempotent). Fire-and-forget: a
// failed list write must never fail the idea/vote action.
async function captureEmail(email: string, source: string): Promise<void> {
  try {
    await db.lead.create({ data: { email, source } })
  } catch (e: unknown) {
    if (!isUniqueViolation(e)) throw e
  }
}

export type IdeaState = { ok: boolean; error: string }

// Public feature-request submission. New ideas land unpublished — they appear on
// the board only after we curate them (admin publish). Optional email joins the
// list and lets us follow up. Rate-limited per IP to stop spam.
export async function submitIdeaAction(_prev: IdeaState, form: FormData): Promise<IdeaState> {
  const rl = await rateLimit("idea_submit", ipFromHeaders(await headers()), 5, 600)
  if (!rl.ok) return { ok: false, error: "Too many submissions. Try again in a few minutes." }

  const title = z.string().trim().min(4).max(120).safeParse(form.get("title"))
  if (!title.success) return { ok: false, error: "Give your idea a short title (4–120 chars)." }

  const detail = z.string().trim().max(1000).optional().safeParse(String(form.get("detail") ?? "").trim() || undefined)
  if (!detail.success) return { ok: false, error: "Keep the detail under 1000 characters." }

  const category = String(form.get("category") ?? "").trim().slice(0, 40) || null

  let email: string | undefined
  const rawEmail = String(form.get("email") ?? "").trim()
  if (rawEmail) {
    const parsed = z.string().email().max(200).safeParse(rawEmail)
    if (!parsed.success) return { ok: false, error: "That email doesn't look right (or leave it blank)." }
    email = parsed.data.toLowerCase()
  }

  await db.idea.create({
    data: { title: title.data, detail: detail.data ?? null, category, authorEmail: email ?? null },
  })
  if (email) await captureEmail(email, "feedback-idea")

  revalidatePath("/roadmap")
  return { ok: true, error: "" }
}

export type VoteResult = { ok: boolean; votes?: number; alreadyVoted?: boolean; error?: string }

// One vote per voter per idea. Dedup by email when given, else by hashed IP.
// Vote insert + counter bump are atomic so the displayed count can't drift.
export async function voteIdeaAction(ideaId: string, email?: string): Promise<VoteResult> {
  const ip = ipFromHeaders(await headers())
  const rl = await rateLimit("idea_vote", ip, 40, 600)
  if (!rl.ok) return { ok: false, error: "Too many votes. Try again shortly." }

  if (!z.string().cuid().safeParse(ideaId).success) return { ok: false, error: "Unknown idea." }

  let cleanEmail: string | undefined
  if (email) {
    const parsed = z.string().email().max(200).safeParse(email.trim())
    if (parsed.success) cleanEmail = parsed.data.toLowerCase()
  }
  const voterKey = cleanEmail ? `e:${cleanEmail}` : `ip:${createHash("sha256").update(ip).digest("hex")}`

  try {
    const idea = await db.$transaction(async (tx) => {
      await tx.ideaVote.create({ data: { ideaId, voterKey } })
      return tx.idea.update({ where: { id: ideaId }, data: { voteCount: { increment: 1 } }, select: { voteCount: true } })
    })
    if (cleanEmail) await captureEmail(cleanEmail, "feedback-vote")
    revalidatePath("/roadmap")
    return { ok: true, votes: idea.voteCount }
  } catch (e: unknown) {
    if (isUniqueViolation(e)) {
      const idea = await db.idea.findUnique({ where: { id: ideaId }, select: { voteCount: true } })
      return { ok: true, votes: idea?.voteCount, alreadyVoted: true }
    }
    throw e
  }
}
