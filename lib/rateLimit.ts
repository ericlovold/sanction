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
 * Fixed-window limiter. The DB increment is atomic, so concurrent requests are
 * serialized on the row and the post-increment count check is accurate; only the
 * window *reset* can race (harmless — at worst a couple extra requests slip in
 * at a window boundary). Returns ok:false with retryAfter (seconds) when over.
 */
export async function rateLimit(bucket: string, ip: string, limit: number, windowSeconds: number): Promise<RateResult> {
  const key = `${bucket}:${ip}`
  const now = new Date()

  const existing = await db.rateLimit.findUnique({ where: { key } })
  if (!existing || existing.windowEnd <= now) {
    const windowEnd = new Date(now.getTime() + windowSeconds * 1000)
    await db.rateLimit.upsert({
      where: { key },
      create: { key, count: 1, windowEnd },
      update: { count: 1, windowEnd },
    })
    return { ok: true, limit }
  }

  const updated = await db.rateLimit.update({ where: { key }, data: { count: { increment: 1 } } })
  if (updated.count > limit) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((existing.windowEnd.getTime() - now.getTime()) / 1000)), limit }
  }
  return { ok: true, limit }
}
