// Pure helpers for the reporting/audit endpoints — kept out of the route handlers
// so they're unit-testable (mirrors lib/policy.ts, lib/decisions.ts).

/** A UTC calendar-day window [start, end) for a YYYY-MM-DD string. Throws if malformed. */
export function dayRangeUtc(date: string): { start: Date; end: Date } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("date must be YYYY-MM-DD")
  const start = new Date(`${date}T00:00:00.000Z`)
  if (Number.isNaN(start.getTime())) throw new Error("invalid date")
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return { start, end }
}

/** Map an AuthorizationRequest status to a stable audit event type. */
export function authEventType(status: string): string {
  switch (status) {
    case "approved": return "authorization.approved"
    case "denied": return "authorization.denied"
    case "escalated": return "authorization.escalated"
    case "pending": return "authorization.pending"
    default: return `authorization.${status}`
  }
}

/** Merge pre-sorted-desc event lists into one desc-by-`at` feed, capped at `limit`. */
export function mergeEvents<T extends { at: string }>(lists: T[][], limit: number): T[] {
  return lists
    .flat()
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, limit)
}
