// Seat health: which seats are drifting — a denial rate that's climbing, or a
// seat that keeps hitting the same rule, is a misconfiguration burning
// goodwill before it burns budget. Pure over pre-fetched counts (no IO), same
// contract as the rules engine, so drift logic unit-tests without a database.

export type SeatCounts = { approved: number; denied: number; escalated: number }

export type SeatHealthInput = {
  id: string
  name: string
  /** Whole reporting window (this month). */
  month: SeatCounts
  /** Recent slice of the same window (last 7 days). */
  recent: SeatCounts
  /** Most-hit denial code this month, if any. */
  topDenial?: { code: string; count: number }
}

export type SeatFlag = {
  id: string
  name: string
  denialRateMonth: number
  denialRateRecent: number
  escalationRateMonth: number
  /** Denial rate ≥ HOT_DENIAL_RATE over a meaningful sample. */
  hot: boolean
  /** Recent denial rate meaningfully above the month's baseline. */
  climbing: boolean
  topDenial?: { code: string; count: number }
}

// Below this many decisions a rate is noise, not a signal.
const MIN_MONTH_DECISIONS = 5
const MIN_RECENT_DECISIONS = 3
const HOT_DENIAL_RATE = 0.25
// "Climbing" = recent rate at least 1.5× the month baseline and worth acting on.
const CLIMB_FACTOR = 1.5
const MIN_CLIMB_RATE = 0.2

const total = (c: SeatCounts) => c.approved + c.denied + c.escalated
const rate = (n: number, d: number) => (d > 0 ? n / d : 0)

/**
 * Returns only the seats worth a second look, worst first. A healthy fleet
 * returns [] — the console renders that as good news, not an empty table.
 */
export function seatHealth(rows: SeatHealthInput[]): SeatFlag[] {
  const flags: SeatFlag[] = []
  for (const row of rows) {
    const monthTotal = total(row.month)
    if (monthTotal < MIN_MONTH_DECISIONS) continue

    const denialRateMonth = rate(row.month.denied, monthTotal)
    const recentTotal = total(row.recent)
    const denialRateRecent = rate(row.recent.denied, recentTotal)

    const hot = denialRateMonth >= HOT_DENIAL_RATE
    const climbing =
      recentTotal >= MIN_RECENT_DECISIONS &&
      denialRateRecent >= MIN_CLIMB_RATE &&
      denialRateRecent >= denialRateMonth * CLIMB_FACTOR

    if (!hot && !climbing) continue
    flags.push({
      id: row.id,
      name: row.name,
      denialRateMonth,
      denialRateRecent,
      escalationRateMonth: rate(row.month.escalated, monthTotal),
      hot,
      climbing,
      topDenial: row.topDenial,
    })
  }
  return flags.sort(
    (a, b) => Math.max(b.denialRateRecent, b.denialRateMonth) - Math.max(a.denialRateRecent, a.denialRateMonth),
  )
}
