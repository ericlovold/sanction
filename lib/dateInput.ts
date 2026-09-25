// Parse an <input type="date"> value into end-of-day. Blank means "no date"
// (null); anything that is not a real YYYY-MM-DD calendar day is malformed
// (undefined) so callers refuse it instead of silently clearing an expiry.
export function parseEndOfDay(raw: string): Date | null | undefined {
  if (raw === "") return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (!m) return undefined
  const d = new Date(`${raw}T23:59:59`)
  if (Number.isNaN(d.getTime())) return undefined
  if (d.getFullYear() !== Number(m[1]) || d.getMonth() + 1 !== Number(m[2]) || d.getDate() !== Number(m[3])) {
    return undefined
  }
  return d
}
