import { db } from "./db"

/** Best-effort client IP from a Headers object (Vercel sets x-forwarded-for). */
export function ipFromHeaders(h: Headers): string {
  const xff = h.get("x-forwarded-for")
  if (xff) return xff.split(",")[0]!.trim()
  return h.get("x-real-ip") ?? "unknown"
}

/** Best-effort client IP from a Request (route handlers). */
export function clientIp(req: Request): string {
  return ipFromHeaders(req.headers)
}

export type RateResult = { ok: boolean; retryAfter?: number; limit: number }

/**
 * Shared fixed-window limiter. One atomic upsert counts each request, including
 * concurrent first hits and window resets, without a separate database read.
 * Returns ok:false with retryAfter (seconds) when over; DB errors propagate.
 */
export async function rateLimit(bucket: string, ip: string, limit: number, windowSeconds: number): Promise<RateResult> {
  const key = `${bucket}:${ip}`
  const now = new Date()

  const windowEnd = new Date(now.getTime() + windowSeconds * 1000)
  const [updated] = await db.$queryRaw<{ count: number; windowEnd: Date }[]>`
    INSERT INTO "RateLimit" ("key", "count", "windowEnd")
    VALUES (${key}, 1, ${windowEnd})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."windowEnd" <= ${now}
        THEN 1 ELSE "RateLimit"."count" + 1 END,
      "windowEnd" = CASE WHEN "RateLimit"."windowEnd" <= ${now}
        THEN EXCLUDED."windowEnd" ELSE "RateLimit"."windowEnd" END
    RETURNING "count", "windowEnd"
  `
  if (!updated) throw new Error("Rate limit counter was not returned")
  if (updated.count > limit) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((updated.windowEnd.getTime() - now.getTime()) / 1000)), limit }
  }
  return { ok: true, limit }
}
