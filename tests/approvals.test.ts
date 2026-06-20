import { describe, it, expect } from "vitest"
import { escalationExpired } from "../lib/approvals"
import { decisionCode, REMEDIATION } from "../lib/decisions"

describe("escalationExpired (UX-2 timeout)", () => {
  const minsAgo = (m: number) => new Date(Date.now() - m * 60_000)

  it("is false before the deadline", () => {
    expect(escalationExpired(minsAgo(30), 60)).toBe(false)
  })

  it("is true after the deadline", () => {
    expect(escalationExpired(minsAgo(61), 60)).toBe(true)
  })

  it("treats 0 (or less) as never-expire", () => {
    expect(escalationExpired(minsAgo(10_000), 0)).toBe(false)
    expect(escalationExpired(minsAgo(10_000), -5)).toBe(false)
  })
})

describe("timed-out escalation maps to a typed code", () => {
  it("denied-on-timeout → ESCALATION_TIMED_OUT", () => {
    expect(decisionCode("denied", "Escalation timed out after 60m — auto-denied by policy")).toBe(
      "ESCALATION_TIMED_OUT",
    )
    expect(REMEDIATION.ESCALATION_TIMED_OUT).toBeTruthy()
  })

  it("approved-on-timeout has no code (it is an approval)", () => {
    expect(decisionCode("approved", "Escalation timed out after 60m — auto-approved by policy")).toBeUndefined()
  })
})
