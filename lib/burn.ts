// Burn math for "no surprises": threshold-crossing detection (fire the early
// warning exactly once, on the charge that crosses the line) and linear
// end-of-day pace projection for dashboards. Pure — no IO, unit-agnostic
// (pass cents with cents, dollars with dollars).

export const ALERT_THRESHOLD_PCT = 80

/**
 * True exactly when this charge pushes cumulative spend from below the
 * threshold line to at-or-above it. Callers evaluate at write time (under
 * their existing per-agent lock / atomic counter), so the alert fires once
 * per scope per day, not on every request after the line.
 */
export function crossedThreshold(prev: number, next: number, cap: number | null, pct = ALERT_THRESHOLD_PCT): boolean {
  if (cap == null || cap <= 0) return false
  const line = (cap * pct) / 100
  return prev < line && next >= line
}

export type Pace = {
  /** Projected end-of-day total at the current linear pace; null while the day is too young to extrapolate. */
  onPace: number | null
  /** Projected to hit the cap before midnight. */
  willExhaust: boolean
  /** Linear ETA of the cap hit; null if not exhausting or no cap. */
  exhaustAt: Date | null
  /** Percent of cap already used; null when uncapped. */
  pctOfCap: number | null
}

const DAY_MS = 86_400_000
// Morning guard: don't extrapolate the first ~72 minutes of a day — one early
// charge would project absurd end-of-day totals. (Raised from ~30m after the
// runway board shipped; a 6am charge was still projecting wildly.)
const MIN_FRACTION = 0.05

export function dailyPace(spent: number, cap: number | null, now: Date): Pace {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const fraction = Math.min(1, (now.getTime() - start.getTime()) / DAY_MS)
  const pctOfCap = cap && cap > 0 ? (spent / cap) * 100 : null

  if (spent <= 0 || fraction < MIN_FRACTION) {
    return { onPace: null, willExhaust: false, exhaustAt: null, pctOfCap }
  }

  const onPace = spent / fraction
  const willExhaust = cap != null && cap > 0 && spent < cap && onPace >= cap
  const exhaustAt = willExhaust
    ? new Date(start.getTime() + (now.getTime() - start.getTime()) * (cap / spent))
    : null
  return { onPace, willExhaust, exhaustAt, pctOfCap }
}

// Month-scale projection for "will this month's budget survive?" — the same
// linear model, month-length aware. The early-month guard is proportionally
// stricter: day one of a month is ~3% elapsed, and a single purchase would
// project a wild month-end total.
const MIN_MONTH_FRACTION = 0.05

/**
 * Bucket dated amounts into per-day totals over `days` consecutive local days
 * starting at `start` (time-of-day on `start` is ignored). Events outside the
 * window are dropped. Same day math the 14-day trend uses, factored pure so
 * the runway chart can be tested without a database.
 */
export function bucketByDay(events: { at: Date; amount: number }[], start: Date, days: number): number[] {
  const dayStart = new Date(start)
  dayStart.setHours(0, 0, 0, 0)
  const totals = new Array<number>(days).fill(0)
  for (const e of events) {
    const d = new Date(e.at)
    d.setHours(0, 0, 0, 0)
    const idx = Math.round((d.getTime() - dayStart.getTime()) / DAY_MS)
    if (idx >= 0 && idx < days) totals[idx] += e.amount
  }
  return totals
}

/** Running total: [3,1,4] → [3,4,8]. */
export function cumulative(values: number[]): number[] {
  let sum = 0
  return values.map((v) => (sum += v))
}

export function monthlyPace(spent: number, cap: number | null, now: Date): Pace {
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const span = end.getTime() - start.getTime()
  const fraction = Math.min(1, (now.getTime() - start.getTime()) / span)
  const pctOfCap = cap && cap > 0 ? (spent / cap) * 100 : null

  if (spent <= 0 || fraction < MIN_MONTH_FRACTION) {
    return { onPace: null, willExhaust: false, exhaustAt: null, pctOfCap }
  }

  const onPace = spent / fraction
  const willExhaust = cap != null && cap > 0 && spent < cap && onPace >= cap
  const exhaustAt = willExhaust
    ? new Date(start.getTime() + (now.getTime() - start.getTime()) * (cap / spent))
    : null
  return { onPace, willExhaust, exhaustAt, pctOfCap }
}
