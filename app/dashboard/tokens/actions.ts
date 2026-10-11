"use server"

import { revalidatePath } from "next/cache"
import { withTenant } from "@/lib/rls"
import { requireSessionRole } from "@/lib/session"

export async function revokeExecutionTokenAction(form: FormData): Promise<void> {
  const wallet = await requireSessionRole("admin")
  if (!wallet) return
  const id = String(form.get("id") ?? "")
  if (!id) return
  await withTenant(wallet.id, (tx) => tx.executionToken.updateMany({
    where: { id, walletId: wallet.id, status: "active" },
    data: { status: "revoked", revokedAt: new Date() },
  }))
  revalidatePath("/dashboard/tokens")
}
