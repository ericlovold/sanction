"use client"

import { useSyncExternalStore } from "react"
import { TrackCTA } from "@/components/track-cta"
import { OPERATORS_HOUR, formatSessionDate, nextOperatorsHour } from "@/lib/operatorsHour"

// The homepage is static, so the server HTML carries whatever date the last
// build computed. The browser recomputes from the schedule rule; hydration
// starts from the server value and then switches, so a stale build never shows
// a past session and the first client pass still matches the server HTML.
const atBuildTime = formatSessionDate(nextOperatorsHour())
const noSubscription = () => () => {}

export function OperatorsHourRibbon() {
  const date = useSyncExternalStore(
    noSubscription,
    () => formatSessionDate(nextOperatorsHour()),
    () => atBuildTime,
  )

  return (
    <TrackCTA className="sn-ribbon" href={OPERATORS_HOUR.href} location="ribbon" target="operators-hour">
      <span className="sn-mono sn-ribbon-date">{date}</span>
      {OPERATORS_HOUR.name}
      <span className="sn-ribbon-cta">{OPERATORS_HOUR.cta} →</span>
    </TrackCTA>
  )
}
