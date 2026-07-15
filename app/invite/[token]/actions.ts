"use server"

import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { db } from "@/lib/db"
import { hashApiKey } from "@/lib/apiKey"
import { auth } from "@/lib/auth-config"

export type AcceptInviteState = { error: string }

// Accept a team invite (WALLET-MEMBERS). Mirrors the MagicLink single-use
// claim in app/login/actions.ts: an updateMany keyed on status:"pending" wins
// the race atomically, so a doubled click (or a retried form submit) can only
// ever activate the membership once.
export async function acceptInviteAction(_prev: AcceptInviteState, form: FormData): Promise<AcceptInviteState> {
  const token = String(form.get("token") ?? "").trim()
  if (!token) return { error: "Missing invite token." }

  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { error: "Sign in first, then accept the invite." }

  const invite = await db.walletMember.findUnique({ where: { tokenHash: hashApiKey(token) } })
  if (!invite || invite.status !== "pending" || !invite.tokenExpiresAt || invite.tokenExpiresAt < new Date()) {
    return { error: "This invite is invalid or has expired. Ask for a new one." }
  }

  if (session.user.email.toLowerCase() !== invite.email.toLowerCase()) {
    return { error: `This invite was sent to ${invite.email}. Sign out and accept it with that account.` }
  }

  // Collision guard: someone who already owns a different wallet can't also
  // land here through normal login (lib/session.ts's resolveWalletForUser
  // precedence — owning a wallet always wins), so an "active" membership
  // would be permanently unreachable. Block instead of creating dead state.
  const owned = await db.wallet.findFirst({ where: { userId: session.user.id } })
  if (owned && owned.id !== invite.walletId) {
    return { error: "You already have a Sanction workspace — multi-workspace switching isn't supported yet. Contact us if you need this." }
  }

  const claimed = await db.walletMember.updateMany({
    where: { id: invite.id, status: "pending" },
    data: { status: "active", userId: session.user.id, acceptedAt: new Date(), tokenHash: null, tokenExpiresAt: null },
  })
  if (claimed.count === 0) return { error: "This invite was already used. Ask for a new one." }

  redirect("/dashboard")
}
