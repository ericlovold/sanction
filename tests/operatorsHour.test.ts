import { describe, expect, it } from "vitest"
import { formatSessionDate, nextOperatorsHour } from "@/lib/operatorsHour"

// Local-time dates throughout, matching how the banner computes in the browser.
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h)
const ymd = (date: Date) => [date.getFullYear(), date.getMonth() + 1, date.getDate()]

describe("nextOperatorsHour", () => {
  it("returns this month's second Wednesday before it happens", () => {
    // October 2026: the 1st is a Thursday, so Wednesdays fall on 7 and 14.
    expect(ymd(nextOperatorsHour(at(2026, 10, 1)))).toEqual([2026, 10, 14])
  })

  it("holds on the session for the whole day it runs", () => {
    expect(ymd(nextOperatorsHour(at(2026, 10, 14, 23)))).toEqual([2026, 10, 14])
  })

  it("moves to next month the day after a session", () => {
    // November 2026: the 1st is a Sunday, so Wednesdays fall on 4 and 11.
    expect(ymd(nextOperatorsHour(at(2026, 10, 15, 0)))).toEqual([2026, 11, 11])
  })

  it("handles a month that starts on a Wednesday", () => {
    // September 2027: the 1st is a Wednesday, so the second is the 8th.
    expect(ymd(nextOperatorsHour(at(2027, 9, 1)))).toEqual([2027, 9, 8])
  })

  it("rolls December into January", () => {
    // December 2026's session is the 9th; January 2027's is the 13th.
    expect(ymd(nextOperatorsHour(at(2026, 12, 20)))).toEqual([2027, 1, 13])
  })
})

describe("formatSessionDate", () => {
  it("reads as a month and day", () => {
    expect(formatSessionDate(at(2026, 10, 14))).toBe("October 14")
  })
})
