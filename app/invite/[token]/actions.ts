"use server"

import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { db } from "@/lib/db"
import { hashApiKey } from "@/lib/apiKey"
import { auth } from "@/lib/auth-config"
import { setActiveWallet } from "@/lib/session"

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

  // Owning another wallet is no longer a blocker: the wallet switcher
  // (WALLET-MEMBERS part 2) makes every active membership reachable, so the
  // old collision guard — which existed only to prevent unreachable "active"
  // rows under the owned-wallet-always-wins precedence — is gone.
  const claimed = await db.walletMember.updateMany({
    where: { id: invite.id, status: "pending" },
    data: { status: "active", userId: session.user.id, acceptedAt: new Date(), tokenHash: null, tokenExpiresAt: null },
  })
  if (claimed.count === 0) return { error: "This invite was already used. Ask for a new one." }

  // Land them in the workspace they just joined, not whatever the default
  // precedence would pick.
  await setActiveWallet(invite.walletId)
  redirect("/dashboard")
}
