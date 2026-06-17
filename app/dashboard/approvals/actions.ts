"use server"

import { revalidatePath } from "next/cache"
import { resolveApproval } from "@/lib/approvals"

export type ApprovalActionState = { ok: boolean; message: string }

export async function resolveApprovalAction(
  _prev: ApprovalActionState,
  form: FormData,
): Promise<ApprovalActionState> {
  const walletId = process.env.SANCTION_WALLET_ID
  if (!walletId) return { ok: false, message: "SANCTION_WALLET_ID not set" }

  const requestId = String(form.get("request_id") ?? "")
  const decision = String(form.get("decision") ?? "")
  if (decision !== "approve" && decision !== "reject") return { ok: false, message: "Invalid decision" }

  const result = await resolveApproval(walletId, requestId, decision)
  if (!result.ok) return { ok: false, message: result.error }

  revalidatePath("/dashboard/approvals")
  revalidatePath("/dashboard")
  revalidatePath("/dashboard/spend")
  return { ok: true, message: decision === "approve" ? "Approved" : "Rejected" }
}
