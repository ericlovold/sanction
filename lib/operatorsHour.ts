// The Operator's Hour: a monthly live session, second Wednesday of the month.
// It is the one non-product invitation on getsanction.com, for visitors who
// are not ready to create a wallet. Same event, copy and schedule rule as the
// banner on ericlovold.com, so the two sites never disagree about the date.

export const OPERATORS_HOUR = {
  name: "The Operator’s Hour",
  cta: "Save a seat",
  href: "https://performancelabs.ai/operators-hour",
} as const

/** Second Wednesday of the given month. `month` may overflow (12 is next January). */
function secondWednesday(year: number, month: number): Date {
  const first = new Date(year, month, 1)
  // 3 = Wednesday. Step to the first one, then a week on for the second.
  const daysToFirstWednesday = (3 - first.getDay() + 7) % 7
  return new Date(year, month, 1 + daysToFirstWednesday + 7)
}

/** The next session. Computed from the rule so the banner cannot go stale the
 *  morning after a session runs; the session day itself still shows that day. */
export function nextOperatorsHour(now: Date = new Date()): Date {
  const thisMonth = secondWednesday(now.getFullYear(), now.getMonth())
  const endOfSessionDay = new Date(thisMonth)
  endOfSessionDay.setHours(23, 59, 59, 999)
  return now <= endOfSessionDay ? thisMonth : secondWednesday(now.getFullYear(), now.getMonth() + 1)
}

/** "October 14". */
export function formatSessionDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric" })
}
