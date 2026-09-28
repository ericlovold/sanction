"use client"

import { useSyncExternalStore } from "react"
import { TrackCTA } from "@/components/track-cta"
import { OPERATORS_HOUR, formatSessionDate, nextOperatorsHour } from "@/lib/operatorsHour"

const HOUR_MS = 60 * 60 * 1000
const currentDate = () => formatSessionDate(nextOperatorsHour())

// Re-check hourly so a tab left open across a session day rolls to the next
// date; React re-renders only when the string changes. One timeout aimed at the
// next change would not work: it can be a month out, past setTimeout's ~24.8-day
// limit, where the delay overflows and fires immediately.
function subscribe(onChange: () => void) {
  const id = window.setInterval(onChange, HOUR_MS)
  return () => window.clearInterval(id)
}

// `serverDate` is computed when the page renders (the homepage regenerates
// hourly), so the HTML is current for crawlers and link previews. Hydration
// starts from it, then the browser switches to its own clock without a
// mismatch.
export function OperatorsHourRibbon({ serverDate }: { serverDate: string }) {
  const date = useSyncExternalStore(subscribe, currentDate, () => serverDate)

  return (
    <TrackCTA className="sn-ribbon" href={OPERATORS_HOUR.href} location="ribbon" target="operators-hour">
      <span className="sn-mono sn-ribbon-date">{date}</span>
      {OPERATORS_HOUR.name}
      <span className="sn-ribbon-cta">{OPERATORS_HOUR.cta} →</span>
    </TrackCTA>
  )
}
