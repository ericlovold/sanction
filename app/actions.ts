"use server"

import { headers } from "next/headers"
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
