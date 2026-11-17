import { db } from "@/lib/db"

/** The Spend page's 14-day token trend and full calendar month of runway data. */
export async function readSpendChartDays(walletIds: string[], agentIds: string[], today: Date) {
  const year = today.getFullYear()
  const month = today.getMonth()
  const trendStartDay = today.getDate() - 13
  const firstDay = Math.min(1, trendStartDay)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const calendar = Array.from({ length: daysInMonth - firstDay + 1 }, (_, i) => ({
    date: new Date(year, month, firstDay + i),
    tokenCost: 0,
    approvedSpend: 0,
  }))
  const monthStartIndex = 1 - firstDay

  if (walletIds.length && agentIds.length) {
    // Prisma stores UTC instants in timestamp-without-time-zone columns. Send
    // each local midnight as UTC so 23- and 25-hour days use the same bounds
    // as the page, regardless of the PostgreSQL session's timezone.
    const boundaries = calendar.map(day => day.date.toISOString())
    const end = new Date(year, month + 1, 1).toISOString()
    const totals = await db.$queryRaw<{ bucket: number; tokenCost: number; approvedSpend: number }[]>`
      WITH scoped_agents AS (
        SELECT id FROM "Agent"
        WHERE "walletId" = ANY(${walletIds}::text[]) AND id = ANY(${agentIds}::text[])
      )
      SELECT width_bucket(events."createdAt", ${boundaries}::timestamp[]) AS bucket,
             SUM(events."tokenCost") AS "tokenCost", SUM(events."approvedSpend") AS "approvedSpend"
      FROM (
        SELECT "createdAt", "costUsd" AS "tokenCost", 0::float8 AS "approvedSpend"
        FROM "TokenLog"
        WHERE "agentId" IN (SELECT id FROM scoped_agents)
          AND "createdAt" >= ${boundaries[0]}::timestamp AND "createdAt" < ${end}::timestamp
        UNION ALL
        SELECT "createdAt", 0::float8, "amountUsd"
        FROM "AuthorizationRequest"
        WHERE "agentId" IN (SELECT id FROM scoped_agents) AND status = 'approved'
          AND "createdAt" >= ${boundaries[monthStartIndex]}::timestamp AND "createdAt" < ${end}::timestamp
      ) events
      GROUP BY 1
    `
    for (const { bucket, tokenCost, approvedSpend } of totals) {
      calendar[bucket - 1].tokenCost = tokenCost
      calendar[bucket - 1].approvedSpend = approvedSpend
    }
  }

  const trendIndex = trendStartDay - firstDay
  const monthDays = calendar.slice(monthStartIndex)
  return {
    days: calendar.slice(trendIndex, trendIndex + 14).map(({ date, tokenCost }) => ({
      label: `${date.getMonth() + 1}/${date.getDate()}`, cost: tokenCost,
    })),
    tokenByMonthDay: monthDays.map(day => day.tokenCost),
    spendByMonthDay: monthDays.map(day => day.approvedSpend),
  }
}
