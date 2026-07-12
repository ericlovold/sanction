"use server"

import { randomBytes } from "crypto"
import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { z } from "zod"
import { db } from "@/lib/db"
import { hashApiKey, generateManagementKey } from "@/lib/apiKey"
import { setSession, clearSession } from "@/lib/session"
import { rateLimit, ipFromHeaders } from "@/lib/rateLimit"
import { sendMagicLinkEmail } from "@/lib/email"

export type LoginState = { error: string }

// Only ever redirect within the app: a next must be a local absolute path.
// Rejected: protocol-relative //host, and anything carrying a backslash (raw
// or %5C-encoded) — browsers normalize \ to / so "/\evil.com" becomes the
// off-site "//evil.com". Anything suspicious falls back to the dashboard.
function safeNext(raw: unknown): string {
  const next = typeof raw === "string" ? raw : ""
  const ok = next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") && !/%5c/i.test(next)
  return ok ? next : "/dashboard"
}

export async function loginAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const ip = ipFromHeaders(await headers())
  const rl = await rateLimit("login", ip, 30, 600)
  if (!rl.ok) return { error: "Too many attempts. Wait a few minutes and try again." }

  const key = String(form.get("management_key") ?? "").trim()
  if (!key) return { error: "Enter your management key." }

  const wallet = await db.wallet.findUnique({ where: { mgmtKeyHash: hashApiKey(key) } })
  if (!wallet) return { error: "That key doesn't match a wallet. Use the management key (sk_…) from signup." }

  await setSession(key)
  redirect(safeNext(form.get("next")))
}

export async function logoutAction() {
  await clearSession()
  redirect("/login")
}

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000

export type MagicLinkRequestState = { sent: boolean; error: string }

// Email a one-time sign-in link. Always reports success (never reveals whether
// an email has an account); only actually sends when a wallet matches.
export async function requestMagicLinkAction(_prev: MagicLinkRequestState, form: FormData): Promise<MagicLinkRequestState> {
  const h = await headers()
  const rl = await rateLimit("magic_link", ipFromHeaders(h), 5, 600)
  if (!rl.ok) return { sent: false, error: "Too many requests. Wait a few minutes and try again." }

  const parsed = z.string().trim().email().max(200).safeParse(form.get("email"))
  if (!parsed.success) return { sent: false, error: "Enter a valid email." }
  const email = parsed.data

  const wallet = await db.wallet.findUnique({ where: { ownerEmail: email } })
  if (wallet) {
    const rawToken = randomBytes(32).toString("hex")
    await db.magicLink.create({
      data: {
        tokenHash: hashApiKey(rawToken),
        walletId: wallet.id,
        email,
        expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS),
      },
    })
    const host = h.get("host") ?? "getsanction.com"
    const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")
    const link = `${proto}://${host}/auth/verify?token=${rawToken}`
    // A provider failure must not 500 the request or reveal account existence —
    // the token row exists, the user can retry; the operator sees the log.
    try {
      await sendMagicLinkEmail(email, link)
    } catch (e) {
      console.error("magic-link email send failed:", e)
    }
  }

  // Same response whether or not a wallet existed.
  return { sent: true, error: "" }
}

export type MagicLinkVerifyState = { ok: boolean; error: string; newKey?: string; walletName?: string }

// Confirm a magic link (POST, so email scanners can't consume it on prefetch):
// single-use claim, then rotate the management key and start a session.
export async function verifyMagicLinkAction(_prev: MagicLinkVerifyState, form: FormData): Promise<MagicLinkVerifyState> {
  const token = String(form.get("token") ?? "").trim()
  if (!token) return { ok: false, error: "Missing token." }

  const link = await db.magicLink.findUnique({ where: { tokenHash: hashApiKey(token) } })
  if (!link || link.usedAt || link.expiresAt < new Date()) {
    return { ok: false, error: "This link is invalid or expired. Request a new one." }
  }

  // Single-use claim: only the request that flips usedAt from null wins.
  const claimed = await db.magicLink.updateMany({
    where: { id: link.id, usedAt: null },
    data: { usedAt: new Date() },
  })
  if (claimed.count === 0) return { ok: false, error: "This link was already used. Request a new one." }

  // Rotate the management key — we never stored the old one in the clear, so
  // recovery means issuing a fresh key (agents' pxy_ keys are unaffected).
  const mgmt = generateManagementKey()
  const wallet = await db.wallet.update({
    where: { id: link.walletId },
    data: { mgmtKeyHash: mgmt.hash, mgmtKeyPrefix: mgmt.prefix },
  })

  await setSession(mgmt.raw)
  return { ok: true, error: "", newKey: mgmt.raw, walletName: wallet.name }
}
