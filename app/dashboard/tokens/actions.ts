"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { requireSessionRole } from "@/lib/session"

export async function revokeExecutionTokenAction(form: FormData): Promise<void> {
  const wallet = await requireSessionRole("admin")
  if (!wallet) return
  const id = String(form.get("id") ?? "")
  if (!id) return
  const token = await db.executionToken.findUnique({ where: { id } })
  if (!token || token.walletId !== wallet.id || token.status !== "active") return
  await db.executionToken.update({
    where: { id },
    data: { status: "revoked", revokedAt: new Date() },
  })
  revalidatePath("/dashboard/tokens")
}
