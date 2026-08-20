import { describe, it, expect } from "vitest"
import { decideTool } from "../lib/toolDecisions"
import type { ToolContext } from "../lib/rules/tool"

const BASE: Omit<ToolContext, "tool"> = { blockedTools: [], allowedTools: [], escalateTools: [] }
const decide = (tool: string, over: Partial<ToolContext> = {}) => decideTool({ tool, ...BASE, ...over })

describe("decideTool — tool governance", () => {
  it("allows any tool when no lists are set (governance opt-in)", () => {
    expect(decide("github.create_deployment")).toEqual({ status: "allowed", code: undefined, reason: undefined })
  })

  it("denies a blocked tool", () => {
    expect(decide("shell.exec", { blockedTools: ["shell.exec"] })).toEqual({
      status: "denied",
      code: "TOOL_BLOCKED",
      reason: "Tool 'shell.exec' is blocked",
    })
  })

  it("denies a tool missing from a non-empty allow-list", () => {
    expect(decide("email.send", { allowedTools: ["github.search"] })).toEqual({
      status: "denied",
      code: "TOOL_NOT_ALLOWED",
      reason: "Tool 'email.send' is not in the allow-list",
    })
  })

  it("allows a tool present in the allow-list", () => {
    expect(decide("github.search", { allowedTools: ["github.search"] }).status).toBe("allowed")
  })

  it("escalates a tool on the escalate-list", () => {
    expect(decide("github.create_deployment", { escalateTools: ["github.create_deployment"] })).toEqual({
      status: "escalated",
      code: "TOOL_ESCALATION_REQUIRED",
      reason: "Tool 'github.create_deployment' requires human approval",
    })
  })

  it("deny-overrides escalate — a blocked tool is denied even if also on the escalate-list", () => {
    expect(decide("shell.exec", { blockedTools: ["shell.exec"], escalateTools: ["shell.exec"] }).status).toBe("denied")
  })
})

// ── COND-1: context-conditional tool rules ───────────────────────────────────

describe("conditional rules — outside_hours_utc", () => {
  const conditions = [{ pattern: "deploy.*", effect: "escalate" as const, when: { outside_hours_utc: [9, 17] as [number, number] } }]

  it("escalates outside the window, allows inside", () => {
    expect(decide("deploy.prod", { conditions, requestHourUtc: 3 }).status).toBe("escalated")
    expect(decide("deploy.prod", { conditions, requestHourUtc: 3 }).code).toBe("TOOL_CONDITION_ESCALATION_REQUIRED")
    expect(decide("deploy.prod", { conditions, requestHourUtc: 12 }).status).toBe("allowed")
  })

  it("window boundaries: start is inside, end is outside", () => {
    expect(decide("deploy.prod", { conditions, requestHourUtc: 9 }).status).toBe("allowed")
    expect(decide("deploy.prod", { conditions, requestHourUtc: 17 }).status).toBe("escalated")
  })

  it("a midnight-wrapping window [22, 6] is inside at 23 and 3, outside at noon", () => {
    const wrap = [{ pattern: "*", effect: "block" as const, when: { outside_hours_utc: [22, 6] as [number, number] } }]
    expect(decide("x", { conditions: wrap, requestHourUtc: 23 }).status).toBe("allowed")
    expect(decide("x", { conditions: wrap, requestHourUtc: 3 }).status).toBe("allowed")
    expect(decide("x", { conditions: wrap, requestHourUtc: 12 }).status).toBe("denied")
    expect(decide("x", { conditions: wrap, requestHourUtc: 12 }).code).toBe("TOOL_CONDITION_BLOCKED")
  })

  it("a rule whose signal is absent is inactive (pre-COND rows replay unchanged)", () => {
    expect(decide("deploy.prod", { conditions }).status).toBe("allowed")
  })
})

describe("conditional rules — after_model_calls_today", () => {
  const conditions = [{ pattern: "*", effect: "block" as const, when: { after_model_calls_today: 500 } }]

  it("blocks at and past the threshold, allows below, names the counts", () => {
    expect(decide("web.search", { conditions, modelCallsToday: 499 }).status).toBe("allowed")
    const at = decide("web.search", { conditions, modelCallsToday: 500 })
    expect(at.status).toBe("denied")
    expect(at.reason).toContain("after 500 model calls today (500 so far)")
    expect(decide("web.search", { conditions, modelCallsToday: 5000 }).status).toBe("denied")
  })

  it("absent signal = inactive", () => {
    expect(decide("web.search", { conditions }).status).toBe("allowed")
  })
})

describe("conditional rules — precedence", () => {
  it("an unconditional block beats a conditional escalate", () => {
    const d = decide("x", {
      blockedTools: ["x"],
      conditions: [{ pattern: "x", effect: "escalate", when: { after_model_calls_today: 1 } }],
      modelCallsToday: 10,
    })
    expect(d.code).toBe("TOOL_BLOCKED")
  })

  it("a conditional block beats the allow-list mention", () => {
    const d = decide("x", {
      allowedTools: ["x"],
      conditions: [{ pattern: "x", effect: "block", when: { after_model_calls_today: 1 } }],
      modelCallsToday: 1,
    })
    expect(d.code).toBe("TOOL_CONDITION_BLOCKED")
  })

  it("prefix-glob matching on the condition pattern", () => {
    const d = decide("payments.charge", {
      conditions: [{ pattern: "payments.*", effect: "block", when: { after_model_calls_today: 1 } }],
      modelCallsToday: 2,
    })
    expect(d.code).toBe("TOOL_CONDITION_BLOCKED")
  })
})
