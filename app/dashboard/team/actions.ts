"use server"

import { randomBytes } from "crypto"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { db } from "@/lib/db"
import { hashApiKey } from "@/lib/apiKey"
import { getSessionMember } from "@/lib/session"
import { hasRole, type WalletRole } from "@/lib/roles"
import { rateLimit, ipFromHeaders } from "@/lib/rateLimit"
import { sendInviteEmail } from "@/lib/email"

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const ROLE_LABEL: Record<WalletRole, string> = { owner: "Owner", admin: "Admin", viewer: "Viewer" }
const roleSchema = z.enum(["owner", "admin", "viewer"])

// Owner-only guard shared by every action in this file — team membership and
// role changes are the one thing even an Admin can't do (lib/roles.ts).
async function requireOwner() {
  const member = await getSessionMember()
  if (!member || !hasRole(member.role, "owner")) return null
  return member
}

export type InviteState = { ok: boolean; error: string }

export async function inviteMemberAction(_prev: InviteState, form: FormData): Promise<InviteState> {
  const member = await requireOwner()
  if (!member) return { ok: false, error: "Only the wallet owner can invite team members." }

  const ip = ipFromHeaders(await headers())
  const rl = await rateLimit("invite_send", ip, 20, 600)
  if (!rl.ok) return { ok: false, error: "Too many invites sent. Wait a few minutes and try again." }

  const emailParsed = z.string().trim().toLowerCase().email().max(200).safeParse(form.get("email"))
  if (!emailParsed.success) return { ok: false, error: "Enter a valid email." }
  const email = emailParsed.data

  const roleParsed = roleSchema.safeParse(form.get("role"))
  if (!roleParsed.success) return { ok: false, error: "Choose a role." }
  const role = roleParsed.data

  if (email === member.wallet.ownerEmail.toLowerCase()) {
    return { ok: false, error: "That's already the wallet owner." }
  }

  const existing = await db.walletMember.findUnique({ where: { walletId_email: { walletId: member.wallet.id, email } } })
  if (existing?.status === "active") {
    return { ok: false, error: "Already a member — change their role below instead of re-inviting." }
  }

  const rawToken = randomBytes(32).toString("hex")
  const tokenHash = hashApiKey(rawToken)
  const tokenExpiresAt = new Date(Date.now() + INVITE_TTL_MS)

  if (existing) {
    await db.walletMember.update({
      where: { id: existing.id },
      data: { role, status: "pending", tokenHash, tokenExpiresAt, invitedByUserId: member.actor.type === "user" ? member.actor.userId : null },
    })
  } else {
    await db.walletMember.create({
      data: {
        walletId: member.wallet.id,
        email,
        role,
        status: "pending",
        tokenHash,
        tokenExpiresAt,
        invitedByUserId: member.actor.type === "user" ? member.actor.userId : null,
      },
    })
  }

  const h = await headers()
  const host = h.get("host") ?? "getsanction.com"
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")
  const link = `${proto}://${host}/invite/${rawToken}`
  const inviterName = member.actor.type === "user" ? member.actor.name ?? member.actor.email : "The team"

  try {
    await sendInviteEmail(email, { walletName: member.wallet.name, role: ROLE_LABEL[role], inviterName, link })
  } catch (e) {
    console.error("invite email send failed:", e)
    return { ok: false, error: "Invite saved, but the email failed to send. Try again or share the link manually." }
  }

  revalidatePath("/dashboard/team")
  return { ok: true, error: "" }
}

// Plain void action (like setAgentActiveAction in keys/actions.ts) so it binds
// directly to a <form action={changeRoleAction}> with no client wrapper —
// unauthorized/invalid submissions just no-op instead of erroring.
export async function changeRoleAction(form: FormData): Promise<void> {
  const member = await requireOwner()
  if (!member) return

  const memberId = String(form.get("member_id") ?? "")
  const roleParsed = roleSchema.safeParse(form.get("role"))
  if (!roleParsed.success) return

  const target = await db.walletMember.findUnique({ where: { id: memberId } })
  if (!target || target.walletId !== member.wallet.id) return

  await db.walletMember.update({ where: { id: memberId }, data: { role: roleParsed.data } })
  revalidatePath("/dashboard/team")
}

export async function revokeMemberAction(form: FormData): Promise<void> {
  const member = await requireOwner()
  if (!member) return

  const memberId = String(form.get("member_id") ?? "")
  const target = await db.walletMember.findUnique({ where: { id: memberId } })
  if (!target || target.walletId !== member.wallet.id) return

  await db.walletMember.update({ where: { id: memberId }, data: { status: "revoked", tokenHash: null, tokenExpiresAt: null } })
  revalidatePath("/dashboard/team")
}
