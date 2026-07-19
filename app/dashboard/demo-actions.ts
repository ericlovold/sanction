"use server"

import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { track } from "@vercel/analytics/server"
import { db } from "@/lib/db"
import { resolveApproval } from "@/lib/approvals"
import { rateLimit, ipFromHeaders } from "@/lib/rateLimit"
import { FUNNEL } from "@/lib/funnel"
import { getDemoEscalation, type DemoEscalation } from "@/lib/demo"

// The public demo's one interactive moment: a visitor decides a REAL pending
// escalation on the demo wallet — approval mints a real grant on the record —
// and the queue immediately replenishes (the agent "asks again") so the demo
// never runs dry and every visitor gets the moment. Shared by the demo
// dashboard (form action) and the landing hero (structured action).
//
// Scope is structural, not trust-based: the authorized-wallet set passed to
// resolveApproval is exactly [SANCTION_WALLET_ID] from the server environment.
// A forged approval_id belonging to any other wallet resolves to "not found".
// Rate-limited per IP because it is anonymous by design.
async function runDemoDecision(approvalId: string, decision: string, surface: string): Promise<boolean> {
  const demoWalletId = process.env.SANCTION_WALLET_ID
  if (!demoWalletId) return false

  const ip = ipFromHeaders(await headers())
  const rl = await rateLimit("demo_decide", ip, 20, 600)
  if (!rl.ok) return false

  if (!approvalId || (decision !== "approve" && decision !== "reject")) return false

  // Snapshot the row before deciding — it is the template for the replenish.
  const row = await db.pendingApproval.findFirst({
    where: { id: approvalId, walletId: demoWalletId, status: "pending" },
  })
  if (!row) return false

  const result = await resolveApproval([demoWalletId], approvalId, decision, undefined, "demo visitor")
  if (!result.ok) return false

  // The funnel's engagement moment: a visitor governed a live agent. `surface`
  // splits landing-hero decisions from demo-dashboard decisions in analytics.
  void track(FUNNEL.demoDecision, { decision, surface }).catch(() => {})

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

  return true
}

// Demo dashboard: form-submitted decision, revalidates the dashboard views.
export async function decideDemoApprovalAction(form: FormData): Promise<void> {
  const approvalId = String(form.get("approval_id") ?? "")
  const decision = String(form.get("decision") ?? "")
  const ok = await runDemoDecision(approvalId, decision, "dashboard")
  if (!ok) return
  revalidatePath("/dashboard")
  revalidatePath("/dashboard/approvals")
}

// Landing hero: structured call from the interactive card. Returns the next
// escalation so the client can offer "try another" without a full reload.
export async function decideDemoEscalationAction(
  approvalId: string,
  decision: "approve" | "reject",
): Promise<{ ok: boolean; next: DemoEscalation | null }> {
  const ok = await runDemoDecision(approvalId, decision, "landing")
  // Always return the current top escalation — even on a lost race (row already
  // decided by another visitor) the client can advance to a fresh one.
  return { ok, next: await getDemoEscalation() }
}
