import { db } from "@/lib/db"
import { CURSOR_DAILY_EVENTS, CURSOR_DAILY_TOKENS } from "@/lib/connectors/cursorVolume"

// The values are billing items from the signed-in wallet's personal export.
// Never combine them with the team connector's potentially overlapping requests.
type HomeCursorDay = { day: string; items: bigint; tokens: bigint | null }

export async function recentHighCursorDay(walletId: string, now: Date) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 29))
  const rows = await db.$queryRaw<HomeCursorDay[]>`
    SELECT day, items, tokens FROM (
      SELECT to_char("occurredAt", 'YYYY-MM-DD') AS day, count(*) AS items,
             sum(CASE WHEN num_nonnulls("promptTokens", "completionTokens", "cachedPromptTokens", "cacheWriteTokens") > 0
                 THEN coalesce("promptTokens", 0)::bigint + coalesce("completionTokens", 0)
                    + coalesce("cachedPromptTokens", 0) + coalesce("cacheWriteTokens", 0)
                 END)::bigint AS tokens
      FROM "CursorBillingItem"
      WHERE "walletId" = ${walletId} AND product = 'cursor' AND "occurredAt" >= ${start} AND "occurredAt" <= ${now}
      GROUP BY day
    ) AS daily
    WHERE items >= ${CURSOR_DAILY_EVENTS} OR tokens >= ${CURSOR_DAILY_TOKENS}
    ORDER BY day DESC LIMIT 1
  `
  return rows[0] ?? null
}
