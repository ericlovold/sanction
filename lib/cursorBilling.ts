import { z } from "zod"

export const cursorBatchSize = 250
const label = z.string().trim().min(1).max(200)
const count = z.number().int().nonnegative().max(2147483647).nullable()
export const cursorItem = z.object({
  itemId: label, occurredAt: z.string().datetime({ offset: true }), product: z.literal("cursor"),
  chargeCategory: label, usageType: label, currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  contracted: z.string().regex(/^-?\d{1,20}(\.\d{1,10})?$/).nullable(), model: label.nullable(),
  promptTokens: count, completionTokens: count, cachedPromptTokens: count, cacheWriteTokens: count,
}).strict().refine(row => row.contracted === null || row.currency !== null)
export type CursorItem = z.infer<typeof cursorItem>
