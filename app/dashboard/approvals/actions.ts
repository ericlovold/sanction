"use server"

import { revalidatePath } from "next/cache"
import { after } from "next/server"
import { db } from "@/lib/db"
import { resolveApproval } from "@/lib/approvals"
import { getSessionWallet } from "@/lib/session"
import { subtreeWalletIds } from "@/lib/walletSubtree"
import { generateWebhookSecret, deliverPing, isPublicHttpsUrl, KNOWN_EVENTS, DEFAULT_EVENTS } from "@/lib/webhooks"

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

  // The signed-in human is the accountable actor (Art 14 oversight evidence).
  // For social sign-in ownerEmail is that person's email; for a management-key
  // session it's the wallet's owner account.
  //
  // Authority spans the subtree: an org owner can clear an escalation waiting in
  // any pool below their wallet, not only ones raised on their own wallet. The
  // id set is the gate — resolveApproval refuses anything outside it.
  const { ids: authorizedIds } = await subtreeWalletIds(wallet.id)
  const result = await resolveApproval(authorizedIds, approvalId, decision, note, wallet.ownerEmail)
  if (!result.ok) return { ok: false, message: result.error }

  // Only the surfaces that show this decision revalidate on the critical path;
  // Overview and Spend are force-dynamic and refresh on their next visit anyway.
  revalidatePath("/dashboard/approvals")
  return { ok: true, message: decision === "approve" ? "Approved" : "Rejected" }
}

export async function addWebhookAction(_prev: WebhookActionState, form: FormData): Promise<WebhookActionState> {
  const wallet = await getSessionWallet()
  if (!wallet) return { ok: false, message: "Log in to add a webhook." }

  const url = String(form.get("url") ?? "").trim()
  if (!isPublicHttpsUrl(url)) return { ok: false, message: "Enter a public https:// URL." }

  // Per-channel routing: the form submits an events[] subset; anything outside
  // the catalog is dropped, and an empty selection falls back to the defaults.
  const requested = form.getAll("events").map(String)
  const valid = requested.filter((e): e is (typeof KNOWN_EVENTS)[number] => (KNOWN_EVENTS as readonly string[]).includes(e))
  const events = valid.includes("*") ? ["*"] : valid.length > 0 ? valid : DEFAULT_EVENTS

  const secret = generateWebhookSecret()
  await db.webhook.create({
    data: {
      walletId: wallet.id,
      url,
      secret,
      events,
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
