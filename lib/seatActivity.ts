import { db } from "@/lib/db"

type SeatActivity = {
  agentId: string
  totalCalls: number
  topModel: string
  lastTask: string | null
  lastSeen: Date
}

export async function readSeatActivity(walletIds: string[], agentIds: string[]): Promise<SeatActivity[]> {
  if (!walletIds.length || !agentIds.length) return []

  return db.$queryRaw<SeatActivity[]>`
    WITH model_counts AS (
      SELECT a.id AS "agentId", l.model, COUNT(*) AS calls
      FROM "Agent" a
      JOIN "TokenLog" l ON l."agentId" = a.id
      WHERE a."walletId" = ANY(${walletIds}::text[]) AND a.id = ANY(${agentIds}::text[])
      GROUP BY a.id, l.model
    ), activity AS (
      SELECT DISTINCT ON ("agentId") "agentId", model AS "topModel",
             (SUM(calls) OVER (PARTITION BY "agentId"))::double precision AS "totalCalls"
      FROM model_counts
      ORDER BY "agentId", calls DESC, model COLLATE "C" ASC
    )
    SELECT activity.*, latest."taskLabel" AS "lastTask", latest."createdAt" AS "lastSeen"
    FROM activity
    CROSS JOIN LATERAL (
      SELECT l."taskLabel", l."createdAt"
      FROM "TokenLog" l
      WHERE l."agentId" = activity."agentId"
      ORDER BY l."createdAt" DESC, l.id DESC
      LIMIT 1
    ) latest
  `
}
