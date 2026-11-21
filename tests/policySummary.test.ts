import { describe, expect, it } from "vitest"
import { policySummary, waitText, type SummaryPolicy } from "../lib/policySummary"

const base: SummaryPolicy = {
  daily_token_budget_usd: 10,
  daily_spend_budget_usd: 50,
  monthly_spend_budget_usd: null,
  per_transaction_max_usd: 50,
  auto_approve_under_usd: 10,
  escalate_over_usd: 25,
  allowed_categories: [],
  blocked_categories: [],
  allowed_tools: [],
  blocked_tools: [],
  escalate_tools: [],
  capability_rules: [],
  escalation_timeout_mins: 60,
  escalation_timeout_action: "deny",
}

describe("policySummary", () => {
  it("describes the default ladder", () => {
    expect(policySummary(base)).toEqual([
      "Purchases stop at $50.00 a day. Model spend stops at $10.00 a day.",
      "Inside those limits, a purchase up to $25.00 goes through on its own. Above that, up to $50.00, a person is asked. Anything larger is refused.",
      "Any tool may be used unless it is listed below.",
      "Taking on new capabilities (skills, plugins, new APIs) is not governed.",
      "When a person is asked, the request waits up to 1 hour, then is refused.",
    ])
  })

  it("says so when a person can never be asked about a purchase", () => {
    const lines = policySummary({ ...base, escalate_over_usd: 50 })
    expect(lines[1]).toBe(
      "Inside those limits, a purchase up to $50.00 goes through on its own and anything larger is refused. A person is never asked about a purchase.",
    )
  })

  it("uses the always-approve amount when it is above the ask line", () => {
    // The engine approves at or under the always-approve amount before it
    // checks the ask line, so a person is only asked above the larger one.
    expect(policySummary({ ...base, auto_approve_under_usd: 40 })[1]).toBe(
      "Inside those limits, a purchase up to $40.00 goes through on its own. Above that, up to $50.00, a person is asked. Anything larger is refused.",
    )
  })

  it("says every purchase is refused at a zero limit", () => {
    expect(policySummary({ ...base, per_transaction_max_usd: 0, escalate_over_usd: 0 })[1]).toBe(
      "Every purchase is refused, because the largest single purchase is $0.00.",
    )
  })

  it("leads with observe mode, and covers lists, rules and the timeout outcome", () => {
    const lines = policySummary({
      ...base,
      enforcement_mode: "observe",
      monthly_spend_budget_usd: 1000,
      allowed_categories: ["software"],
      blocked_categories: ["gambling", "adult"],
      allowed_tools: ["a", "b"],
      blocked_tools: ["shell.exec"],
      escalate_tools: ["claude-code.Bash"],
      capability_rules: [{ pattern: "*", effect: "escalate" }],
      escalation_timeout_mins: 0,
      escalation_timeout_action: "approve",
    })
    expect(lines[0]).toContain("Observe mode is on")
    expect(lines[1]).toBe("Purchases stop at $50.00 a day and $1,000.00 a month. Model spend stops at $10.00 a day.")
    expect(lines[3]).toBe("Purchases are limited to 1 category. 2 categories are blocked.")
    expect(lines[4]).toBe("Only 2 named tools may be used; any other tool is refused. 1 tool is blocked. 1 tool asks a person every time.")
    expect(lines[5]).toBe("1 rule governs new capabilities (skills, plugins, new APIs).")
    expect(lines[6]).toBe("When a person is asked, the request waits with no time limit.")
  })

  it("approves on timeout when the policy says so, and reads odd rule values safely", () => {
    const lines = policySummary({ ...base, capability_rules: "not a list", escalation_timeout_mins: 90, escalation_timeout_action: "approve" })
    expect(lines.at(-1)).toBe("When a person is asked, the request waits up to 90 minutes, then is approved.")
    expect(lines.at(-2)).toContain("is not governed")
  })

  it("words waits in minutes or whole hours", () => {
    expect(waitText(1)).toBe("1 minute")
    expect(waitText(45)).toBe("45 minutes")
    expect(waitText(60)).toBe("1 hour")
    expect(waitText(1440)).toBe("24 hours")
  })
})
