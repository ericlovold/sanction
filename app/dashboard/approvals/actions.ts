"use server"

import { revalidatePath } from "next/cache"
import { after } from "next/server"
import { db } from "@/lib/db"
import { createSpendPendingApproval, resolveApproval } from "@/lib/approvals"
import { withTenant } from "@/lib/rls"
import { requireSessionRole } from "@/lib/session"
import { subtreeWalletIds } from "@/lib/walletSubtree"
import { generateWebhookSecret, deliverPing, deliverEvent, approveUrlFor, isPublicHttpsUrl, KNOWN_EVENTS, DEFAULT_EVENTS } from "@/lib/webhooks"
import { sendEscalationEmail } from "@/lib/email"

export type ApprovalActionState = { ok: boolean; message: string }

export type WebhookActionState = { ok: boolean; message: string; secret?: string; url?: string }

export async function resolveApprovalAction(
  _prev: ApprovalActionState,
  form: FormData,
): Promise<ApprovalActionState> {
  const wallet = await requireSessionRole("admin")
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
  const wallet = await requireSessionRole("admin")
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
  const wallet = await requireSessionRole("admin")
  if (!wallet) return
  const id = String(form.get("id") ?? "")
  const hook = await db.webhook.findUnique({ where: { id } })
  if (hook && hook.walletId === wallet.id) await db.webhook.delete({ where: { id } })
  revalidatePath("/dashboard/approvals")
}

export async function revokeSlackInstallAction(form: FormData): Promise<void> {
  const wallet = await requireSessionRole("admin")
  if (!wallet) return
  const id = String(form.get("id") ?? "")
  if (!id) return
  await withTenant(wallet.id, (tx) =>
    tx.slackInstall.updateMany({
      where: { id, walletId: wallet.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  )
  revalidatePath("/dashboard/approvals")
}

// SLACK-2: prove the loop in one click. After Add to Slack the channel is
// silent until a real agent escalates — so a new admin never sees the card,
// the Approve button, or the grant. This raises a genuine escalation on one of
// the wallet's own agents: a real AuthorizationRequest + PendingApproval,
// delivered through the same fan-out (Slack card, email, webhooks), resolved
// through the same resolveApproval path. It is labeled as a test in the
// description and tagged `test` so it reads honestly in the audit feed. It does
// not run the rules engine — it is the escalation branch, not a decision.
export const TEST_ESCALATION = {
  amountUsd: 30,
  merchant: "Sanction test",
  category: "software",
  description: "Test escalation sent from the dashboard. Approve or deny it where it reached you.",
} as const

export async function sendTestEscalationAction(_prev: ApprovalActionState, _form: FormData): Promise<ApprovalActionState> {
  const wallet = await requireSessionRole("admin")
  if (!wallet) return { ok: false, message: "Log in as an admin to send a test escalation." }

  const [agent, policy] = await Promise.all([
    db.agent.findFirst({ where: { walletId: wallet.id, isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } }),
    db.policy.findUnique({ where: { walletId: wallet.id }, select: { escalationTimeoutMins: true, escalationTimeoutAction: true } }),
  ])
  if (!agent) return { ok: false, message: "Add an agent first — the test escalation is raised by one of your agents." }
  if (!policy) return { ok: false, message: "This wallet has no policy yet." }

  const { amountUsd, merchant, category, description } = TEST_ESCALATION
  const { request, approval } = await db.$transaction(async (tx) => {
    const request = await tx.authorizationRequest.create({
      data: { agentId: agent.id, action: "purchase", amountUsd, merchant, category, description, status: "escalated", detailsJson: { tags: ["test"] } },
    })
    const approval = await createSpendPendingApproval(tx, {
      walletId: wallet.id,
      agentName: agent.name,
      request: { id: request.id, agentId: agent.id, action: "purchase", amountUsd, merchant, category, description, createdAt: request.createdAt },
      policy,
    })
    return { request, approval }
  })

  const approve_url = approveUrlFor(request.id)
  after(() =>
    Promise.all([
      deliverEvent(wallet.id, "approval.created", {
        approval_id: approval.id,
        request_id: request.id,
        action_type: approval.actionType,
        agent: agent.name,
        resource: approval.resourceJson,
        reason: approval.reason ?? "Test escalation",
        approve_url,
      }),
      deliverEvent(wallet.id, "escalation.created", {
        approval_id: approval.id, request_id: request.id, agent: agent.name, action: "purchase", amount_usd: amountUsd, merchant, category, description, approve_url,
      }),
      sendEscalationEmail(wallet.ownerEmail, { agentName: agent.name, amountUsd, merchant, category, description, approveUrl: approve_url }).catch(() => {}),
    ]),
  )

  revalidatePath("/dashboard/approvals")
  return { ok: true, message: `Test escalation sent as ${agent.name} ($${amountUsd}). Approve or deny it in Slack — the grant shows up here.` }
}
