"use server"

import { createHash } from "node:crypto"
import { z } from "zod"
import { cursorBatchSize, cursorItem, type BillingProduct } from "@/lib/cursorBilling"
import { requireSessionRole } from "@/lib/session"
import { db } from "@/lib/db"

export async function importBillingBatch(expectedWalletId: string, product: BillingProduct, rows: unknown) {
  const wallet = await requireSessionRole("admin")
  if (!wallet || wallet.id !== expectedWalletId) throw Error("Wallet or permissions changed.")
  const batch = z.array(cursorItem).min(1).max(cursorBatchSize).parse(rows)
  if (batch.some(row => row.product !== product)) {
    throw Error("Unexpected billing product.")
  }
  const result = await db.cursorBillingItem.createMany({
    data: batch.map(({ itemId, occurredAt, ...values }) => {
      const hash = createHash("sha256").update(itemId).digest("hex")
      // Cursor imports already use the bare digest. Namespace Grok Bot separately.
      const itemHash = product === "cursor" ? hash : `grok-bot:${hash}`
      return { ...values, walletId: wallet.id, occurredAt: new Date(occurredAt), itemHash }
    }),
    skipDuplicates: true,
  })
  return result.count
}
