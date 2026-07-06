import { describe, it, expect } from "vitest"
import { humanField } from "../components/simulation-report"

// Guidance pass (scoped to sim): the simulation report must never leak a raw
// engine field name to a user. Every known policy field maps to the label the
// editor shows; unknown fields still get prettified, never shown as a token.
describe("humanField", () => {
  it("maps every field the simulation can ignore to a human label", () => {
    // The exact set that lands in ignored_fields for a spend draft.
    expect(humanField("daily_token_budget_usd")).toBe("Daily token budget")
    expect(humanField("subtree_daily_cap_usd")).toBe("Subtree daily cap")
    expect(humanField("allowed_tools")).toBe("Allowed tools")
    expect(humanField("escalation_timeout_mins")).toBe("Escalation timeout")
    expect(humanField("escalation_timeout_action")).toBe("On timeout")
  })

  it("prettifies an unknown field instead of leaking the raw token", () => {
    expect(humanField("some_new_field_usd")).toBe("Some new field")
    expect(humanField("weird_thing")).toBe("Weird thing")
    // Never returns the raw snake_case token or a trailing _usd.
    expect(humanField("future_cap_usd")).not.toMatch(/_/)
  })
})
