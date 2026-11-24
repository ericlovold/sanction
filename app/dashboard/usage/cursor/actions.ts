"use server"

import { createHash } from "node:crypto"
import { z } from "zod"
import { cursorBatchSize, cursorItem } from "@/lib/cursorBilling"
import { requireSessionRole } from "@/lib/session"
import { db } from "@/lib/db"

export async function importCursorBatch(expectedWalletId: string, rows: unknown) {
  const wallet = await requireSessionRole("admin")
  if (!wallet || wallet.id !== expectedWalletId) throw Error("Wallet or permissions changed.")
  const batch = z.array(cursorItem).min(1).max(cursorBatchSize).parse(rows)
  const result = await db.cursorBillingItem.createMany({
    data: batch.map(({ itemId, occurredAt, ...values }) => ({
      ...values, walletId: wallet.id, occurredAt: new Date(occurredAt),
      itemHash: createHash("sha256").update(itemId).digest("hex"),
    })),
    skipDuplicates: true,
  })
  return result.count
}
