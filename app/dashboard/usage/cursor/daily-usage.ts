import { db } from "@/lib/db"

type Counts = {
  items: bigint
  tokens: bigint | null
  cached: bigint | null
  partial: boolean
  cachedPartial: boolean
}

type ModelUsage = Counts & { day: string; model: string | null }
export type DailyUsage = Counts & { day: string; models: ModelUsage[] }

function addReported(left: bigint | null, right: bigint | null) {
  if (left === null) return right
  if (right === null) return left
  return left + right
}

export async function getDailyUsage(walletId: string) {
  // occurredAt is a UTC timestamp WITHOUT TIME ZONE. Group its stored calendar date.
  const rows = await db.$queryRaw<ModelUsage[]>`
    SELECT to_char("occurredAt", 'YYYY-MM-DD') AS day, model, count(*) AS items,
           sum(CASE WHEN num_nonnulls("promptTokens", "completionTokens", "cachedPromptTokens", "cacheWriteTokens") > 0
               THEN coalesce("promptTokens", 0)::bigint + coalesce("completionTokens", 0)
                    + coalesce("cachedPromptTokens", 0) + coalesce("cacheWriteTokens", 0)
               END)::bigint AS tokens,
           sum("cachedPromptTokens") AS cached,
           bool_or(num_nonnulls("promptTokens", "completionTokens", "cachedPromptTokens", "cacheWriteTokens") < 4) AS partial,
           count("cachedPromptTokens") < count(*) AS "cachedPartial"
    FROM "CursorBillingItem"
    WHERE "walletId" = ${walletId}
    GROUP BY day, model
    ORDER BY day DESC, tokens DESC NULLS LAST, model ASC NULLS LAST
  `
  const days = new Map<string, DailyUsage>()
  for (const row of rows) {
    let day = days.get(row.day)
    if (!day) {
      day = { day: row.day, items: BigInt(0), tokens: null, cached: null, partial: false, cachedPartial: false, models: [] }
      days.set(row.day, day)
    }
    day.items += row.items
    day.tokens = addReported(day.tokens, row.tokens)
    day.cached = addReported(day.cached, row.cached)
    day.partial ||= row.partial
    day.cachedPartial ||= row.cachedPartial
    day.models.push(row)
  }
  return [...days.values()]
}
