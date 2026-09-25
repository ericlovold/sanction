"use server"

import { safeNext } from "@/lib/returnPath"
import { randomBytes } from "crypto"
import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { z } from "zod"
import { db } from "@/lib/db"
import { hashApiKey, generateManagementKey } from "@/lib/apiKey"
import { setSession, clearSession, revokePreClaimAccess, sweepPreClaimAccess } from "@/lib/session"
import { rateLimit, ipFromHeaders } from "@/lib/rateLimit"
import { sendMagicLinkEmail } from "@/lib/email"

export type LoginState = { error: string }

export async function loginAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const ip = ipFromHeaders(await headers())
  const rl = await rateLimit("login", ip, 30, 600)
  if (!rl.ok) return { error: "Too many attempts. Wait a few minutes and try again." }

  const key = String(form.get("management_key") ?? "").trim()
  if (!key) return { error: "Enter your management key." }

  const wallet = await db.wallet.findUnique({ where: { mgmtKeyHash: hashApiKey(key) } })
  if (!wallet) return { error: "That key doesn't match a wallet. Use the management key (sk_…) from signup." }

  await clearSession()
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
    const next = safeNext(form.get("next"))
    const link = `${proto}://${host}/auth/verify?token=${rawToken}&next=${encodeURIComponent(next)}`
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

class StaleMagicLink extends Error {}

export type MagicLinkVerifyState = {
  ok: boolean
  error: string
  newKey?: string
  walletName?: string
  // Set when this link was the first proof of an unverified ownerEmail: every
  // agent key minted before it was rotated and deactivated.
  rotatedAgents?: number
}

// Confirm a magic link (POST, so email scanners can't consume it on prefetch):
// single-use claim, then rotate the management key and start a session.
//
// ownerEmail is unverified at signup, so the first magic link on a wallet is a
// claim: whoever set that email may be a squatter holding the sk_ key and
// minting agents. The first proof rotates every pre-claim credential (the same
// set as the social claim, lib/session.ts claimWallet) and marks the email
// verified, in one transaction plus the post-commit sweep. Later links on a
// verified wallet, or any link on a wallet already linked to a signed-in owner,
// are plain key recovery: only the sk_ key rotates.
export async function verifyMagicLinkAction(_prev: MagicLinkVerifyState, form: FormData): Promise<MagicLinkVerifyState> {
  const token = String(form.get("token") ?? "").trim()
  if (!token) return { ok: false, error: "Missing token." }

  const invalid = { ok: false, error: "This link is invalid or expired. Request a new one." }
  const link = await db.magicLink.findUnique({ where: { tokenHash: hashApiKey(token) } })
  if (!link || link.usedAt || link.expiresAt < new Date()) return invalid

  // A link proves only the address it was sent to. If ownerEmail changed since,
  // it proves nothing about the wallet's current owner.
  const current = await db.wallet.findUnique({ where: { id: link.walletId } })
  if (!current || current.ownerEmail !== link.email) return invalid

  // Single-use claim: only the request that flips usedAt from null wins.
  const claimed = await db.magicLink.updateMany({
    where: { id: link.id, usedAt: null },
    data: { usedAt: new Date() },
  })
  if (claimed.count === 0) return { ok: false, error: "This link was already used. Request a new one." }

  // We never stored the old management key in the clear, so recovery means
  // issuing a fresh one.
  const mgmt = generateManagementKey()
  const rotation = await db.$transaction(async (tx) => {
    // Race-safe: only the request that flips ownerEmailVerifiedAt from null (for
    // the address this link proved) runs the claim rotation.
    const firstProof = await tx.wallet.updateMany({
      where: { id: link.walletId, ownerEmail: link.email, ownerEmailVerifiedAt: null },
      data: { ownerEmailVerifiedAt: new Date() },
    })
    // A wallet already linked to a signed-in owner can't be squatted — the
    // first proof of a changed address verifies it without rotating their agents.
    const revoked = firstProof.count === 1 && !current.userId ? await revokePreClaimAccess(tx, link.walletId) : null
    // Rotate the key only while the wallet still carries the address this link
    // proved — an ownerEmail change since the pre-check voids the link, and the
    // throw rolls back the verification above with it.
    const rotated = await tx.wallet.updateMany({
      where: { id: link.walletId, ownerEmail: link.email },
      data: { mgmtKeyHash: mgmt.hash, mgmtKeyPrefix: mgmt.prefix },
    })
    if (rotated.count !== 1) throw new StaleMagicLink()
    const wallet = await tx.wallet.findUniqueOrThrow({ where: { id: link.walletId } })
    return { wallet, rotatedAgents: revoked?.agentsRotated }
  }).catch((e: unknown) => {
    if (e instanceof StaleMagicLink) return null
    throw e
  })
  if (!rotation) return invalid
  const { wallet, rotatedAgents } = rotation
  // Fails closed: if the sweep throws, no session is set and the key is not shown.
  if (rotatedAgents !== undefined) await sweepPreClaimAccess(link.walletId)

  await clearSession()
  await setSession(mgmt.raw)
  return { ok: true, error: "", newKey: mgmt.raw, walletName: wallet.name, rotatedAgents }
}
