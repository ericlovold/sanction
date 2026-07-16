"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { walletSubtreeIds } from "@/lib/poolAccess"
import { upsertPolicyWithRevision } from "@/lib/policy"
import { requireSessionRole } from "@/lib/session"

export type ObserveActionState = { ok: boolean; message: string }

// The C2 flip: observe ↔ enforce is a one-field policy change, but it goes
// through upsertPolicyWithRevision like every other policy mutation so the
// revision chain records exactly when enforcement went live (EVID-1).
export async function setEnforcementModeAction(
  _prev: ObserveActionState,
  form: FormData,
): Promise<ObserveActionState> {
  const wallet = await requireSessionRole("admin")
  if (!wallet) return { ok: false, message: "Log in to change enforcement." }

  const walletId = String(form.get("wallet_id") ?? "")
  const mode = String(form.get("mode") ?? "")
  if (!walletId || (mode !== "enforce" && mode !== "observe")) {
    return { ok: false, message: "Choose a pool and a mode." }
  }

  const allowedWalletIds = await walletSubtreeIds(db, wallet.id)
  if (!allowedWalletIds.includes(walletId)) return { ok: false, message: "Not authorized for that pool." }

  // Flipping mode on a policy that doesn't exist would silently create one
  // with schema defaults — surprising governance. Require an explicit policy.
  const existing = await db.policy.findUnique({ where: { walletId }, select: { id: true } })
  if (!existing) return { ok: false, message: "That pool has no policy yet — set one on the Policy page first." }

  await db.$transaction((tx) => upsertPolicyWithRevision(tx, walletId, { enforcementMode: mode }))

  revalidatePath("/dashboard/observe")
  revalidatePath("/dashboard/policy")
  revalidatePath("/dashboard/pools")
  return {
    ok: true,
    message:
      mode === "enforce"
        ? "Enforcement is live — the same decisions now bind."
        : "Observing — every decision is logged, nothing is blocked.",
  }
}
