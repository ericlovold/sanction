"use server"

import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { resolveApproval } from "@/lib/approvals"
import { rateLimit, ipFromHeaders } from "@/lib/rateLimit"

// The public demo's one interactive moment: a visitor decides a REAL pending
// escalation on the demo wallet — approval mints a real grant on the record —
// and the queue immediately replenishes (the agent "asks again") so the demo
// never runs dry and every visitor gets the moment.
//
// Scope is structural, not trust-based: the authorized-wallet set passed to
// resolveApproval is exactly [SANCTION_WALLET_ID] from the server environment.
// A forged approval_id belonging to any other wallet resolves to "not found".
// Rate-limited per IP because it is anonymous by design.
export async function decideDemoApprovalAction(form: FormData): Promise<void> {
  const demoWalletId = process.env.SANCTION_WALLET_ID
  if (!demoWalletId) return

  const ip = ipFromHeaders(await headers())
  const rl = await rateLimit("demo_decide", ip, 20, 600)
  if (!rl.ok) return

  const approvalId = String(form.get("approval_id") ?? "")
  const decision = String(form.get("decision") ?? "")
  if (!approvalId || (decision !== "approve" && decision !== "reject")) return

  // Snapshot the row before deciding — it is the template for the replenish.
  const row = await db.pendingApproval.findFirst({
    where: { id: approvalId, walletId: demoWalletId, status: "pending" },
  })
  if (!row) return

  const result = await resolveApproval([demoWalletId], approvalId, decision, undefined, "demo visitor")
  if (!result.ok) return

  // Replenish: the same agent raises the same request again, fresh timestamp.
  // Never expires on its own — the queue is the demo's heartbeat.
  await db.pendingApproval.create({
    data: {
      walletId: row.walletId,
      agentId: row.agentId,
      actionType: row.actionType,
      status: "pending",
      subjectJson: row.subjectJson ?? {},
      resourceJson: row.resourceJson ?? {},
      constraintsJson: row.constraintsJson ?? undefined,
      reason: row.reason,
      code: row.code,
      sourceType: row.sourceType,
      sourceId: row.sourceId ? `${row.sourceId}-r${Date.now().toString(36)}` : null,
    },
  })

  revalidatePath("/dashboard")
  revalidatePath("/dashboard/approvals")
}
