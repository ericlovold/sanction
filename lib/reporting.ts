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
    case "approved":
      return "authorization.approved"
    case "denied":
      return "authorization.denied"
    case "escalated":
      return "authorization.escalated"
    case "pending":
      return "authorization.pending"
    default:
      return `authorization.${status}`
  }
}

/** Merge pre-sorted-desc event lists into one desc-by-`at` feed, capped at `limit`. */
export function mergeEvents<T extends { at: string }>(lists: T[][], limit: number): T[] {
  return lists
    .flat()
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, limit)
}

/** A UTC range [start, end) from two YYYY-MM-DD strings, end-inclusive by day. Max 92 days. */
export function rangeUtc(from: string, to: string): { start: Date; end: Date } {
  const { start } = dayRangeUtc(from)
  const { end } = dayRangeUtc(to)
  if (end <= start) throw new Error("to must be on or after from")
  if (end.getTime() - start.getTime() > 92 * 24 * 60 * 60 * 1000) throw new Error("range too large (max 92 days)")
  return { start, end }
}

// CSV export of the audit feed: fixed columns so every event type fits one
// table, RFC 4180 quoting. Finance opens it in a spreadsheet; nothing fancy.
export const CSV_COLUMNS = [
  "at", "type", "id", "agent_id", "agent_name", "action", "amount_usd", "merchant",
  "category", "status", "reason", "model", "cost_usd", "tokens_in", "tokens_out",
  "task_label", "credential_label",
] as const

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return ""
  const s = String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(events: Array<Record<string, unknown>>): string {
  const rows = [CSV_COLUMNS.join(",")]
  for (const e of events) rows.push(CSV_COLUMNS.map((c) => csvEscape(e[c])).join(","))
  return rows.join("\n") + "\n"
}
