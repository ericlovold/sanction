"use server"

import { revalidatePath } from "next/cache"
import { after } from "next/server"
import { db } from "@/lib/db"
import { resolveApproval } from "@/lib/approvals"
import { getSessionWallet } from "@/lib/session"
import { generateWebhookSecret, deliverPing, isPublicHttpsUrl } from "@/lib/webhooks"

export type ApprovalActionState = { ok: boolean; message: string }

export type WebhookActionState = { ok: boolean; message: string; secret?: string; url?: string }

export async function resolveApprovalAction(
  _prev: ApprovalActionState,
  form: FormData,
): Promise<ApprovalActionState> {
  const wallet = await getSessionWallet()
  if (!wallet) return { ok: false, message: "Log in to manage approvals." }

  const approvalId = String(form.get("approval_id") ?? form.get("request_id") ?? "")
  const decision = String(form.get("decision") ?? "")
  const note = String(form.get("note") ?? "").trim() || undefined
  if (decision !== "approve" && decision !== "reject") return { ok: false, message: "Invalid decision" }

  const result = await resolveApproval(wallet.id, approvalId, decision, note)
  if (!result.ok) return { ok: false, message: result.error }

  // Only the surfaces that show this decision revalidate on the critical path;
  // Overview and Spend are force-dynamic and refresh on their next visit anyway.
  revalidatePath("/dashboard/approvals")
  revalidatePath("/dashboard/grants")
  return { ok: true, message: decision === "approve" ? "Approved" : "Rejected" }
}

export async function addWebhookAction(_prev: WebhookActionState, form: FormData): Promise<WebhookActionState> {
  const wallet = await getSessionWallet()
  if (!wallet) return { ok: false, message: "Log in to add a webhook." }

  const url = String(form.get("url") ?? "").trim()
  if (!isPublicHttpsUrl(url)) return { ok: false, message: "Enter a public https:// URL." }

  const secret = generateWebhookSecret()
  await db.webhook.create({
    data: {
      walletId: wallet.id,
      url,
      secret,
      events: ["approval.created", "approval.resolved", "escalation.created", "escalation.resolved", "budget.exhausted"],
    },
  })
  after(() => deliverPing(url, secret))

  revalidatePath("/dashboard/approvals")
  return { ok: true, message: "Webhook added — sent a test ping.", secret, url }
}

export async function removeWebhookAction(form: FormData): Promise<void> {
  const wallet = await getSessionWallet()
  if (!wallet) return
  const id = String(form.get("id") ?? "")
  const hook = await db.webhook.findUnique({ where: { id } })
  if (hook && hook.walletId === wallet.id) await db.webhook.delete({ where: { id } })
  revalidatePath("/dashboard/approvals")
}
