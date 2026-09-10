import { describe, expect, it } from "vitest"
import {
  approvalsEmptyCopy,
  firstHourComplete,
  firstHourSteps,
  looksLikeCodingAgentPack,
  shouldShowFirstHourChecklist,
  type FirstHourSignals,
} from "../lib/firstHour"
import { findPack } from "../lib/policyPacks"

const emptySignals: FirstHourSignals = {
  hasAgent: true,
  hasDecision: false,
  hasSlack: false,
  hasWebhook: false,
  hasGatewayUsage: false,
  codingAgentPackApplied: false,
}

describe("looksLikeCodingAgentPack", () => {
  it("rejects the default empty tool and capability lists", () => {
    expect(looksLikeCodingAgentPack({ enforcementMode: "enforce", allowedTools: [], blockedTools: [], capabilityRules: [] })).toBe(false)
  })

  it("rejects a spend-only tweak that never set tool or capability rails", () => {
    expect(
      looksLikeCodingAgentPack({
        enforcementMode: "enforce", allowedTools: [],
        blockedTools: [],
        capabilityRules: [{ pattern: "*", effect: "escalate" }],
      }),
    ).toBe(false)
  })

  it("accepts the shipped coding-agent-seat pack fields", () => {
    const pack = findPack("coding-agent-seat")
    expect(pack).not.toBeNull()
    expect(
      looksLikeCodingAgentPack({
        enforcementMode: pack!.policy.enforcement_mode ?? "enforce",
        allowedTools: pack!.policy.allowed_tools ?? [],
        blockedTools: pack!.policy.blocked_tools ?? [],
        capabilityRules: pack!.policy.capability_rules ?? [],
      }),
    ).toBe(true)
  })
})

describe("coding-agent policy truth", () => {
  const pack = findPack("coding-agent-seat")!.policy
  const policy = {
    enforcementMode: "enforce",
    allowedTools: pack.allowed_tools!,
    blockedTools: pack.blocked_tools!,
    capabilityRules: pack.capability_rules!,
  }

  it.each(["observe", "", "unknown"])("rejects %s mode", (enforcementMode) => {
    expect(looksLikeCodingAgentPack({ ...policy, enforcementMode })).toBe(false)
  })

  it.each(["allow", "block", "invalid"])("rejects patterns with %s effects", (effect) => {
    const capabilityRules = policy.capabilityRules.map((rule) => ({ ...rule, effect }))
    expect(looksLikeCodingAgentPack({ ...policy, capabilityRules })).toBe(false)
  })

  it("requires each acquisition namespace and the fallback to escalate", () => {
    for (const changed of policy.capabilityRules) {
      const capabilityRules = policy.capabilityRules.map((rule) => rule === changed ? { ...rule, effect: "allow" } : rule)
      expect(looksLikeCodingAgentPack({ ...policy, capabilityRules })).toBe(false)
    }
  })

  it("does not normalize patterns differently from the engine", () => {
    const capabilityRules = policy.capabilityRules.map((rule) => ({ ...rule, pattern: ` ${rule.pattern} ` }))
    expect(looksLikeCodingAgentPack({ ...policy, capabilityRules })).toBe(false)
  })
})

describe("firstHourSteps", () => {
  it("points a new wallet at test escalation, channels, and the coding-agent pack without claiming governance", () => {
    const steps = firstHourSteps(emptySignals)
    expect(steps.map((s) => s.id)).toEqual(["decision", "channel", "policy"])
    expect(steps.every((s) => !s.done)).toBe(true)
    expect(steps[0].href).toBe("/dashboard/approvals#test-escalation")
    expect(steps[0].links[0]?.label).toMatch(/test escalation/i)
    expect(steps[1].hint).toMatch(/cooperative/)
    expect(steps[1].hint).toMatch(/broker intercepts/)
    expect(steps[1].links.map((l) => l.href)).toEqual([
      "/dashboard/approvals",
      "/docs/gateway",
      "/docs/agent-wallet",
    ])
    expect(steps[2].title).toMatch(/Apply the coding-agent pack/)
    expect(steps[2].hint).toMatch(/allow-all/)
    expect(steps[2].hint).not.toMatch(/tool governance is on/i)
    expect(steps[2].links.map((l) => l.href)).toContain("/docs/capability-governance")
  })

  it("does not offer test escalation until an agent exists", () => {
    const steps = firstHourSteps({ ...emptySignals, hasAgent: false })
    expect(steps[0].href).toBe("/dashboard")
    expect(steps[0].links).toEqual([])
    expect(steps[0].hint).toMatch(/Add an agent/)
  })

  it("marks decision done after any persisted authorization", () => {
    const steps = firstHourSteps({ ...emptySignals, hasDecision: true })
    expect(steps[0].done).toBe(true)
    expect(steps[0].hint).toMatch(/on the record/)
  })

  it("marks the channel step done from Slack, a webhook, or gateway usage — not from MCP copy alone", () => {
    expect(firstHourSteps({ ...emptySignals, hasSlack: true })[1].done).toBe(true)
    expect(firstHourSteps({ ...emptySignals, hasWebhook: true })[1].done).toBe(true)
    expect(firstHourSteps({ ...emptySignals, hasGatewayUsage: true })[1].done).toBe(true)
    expect(firstHourSteps(emptySignals)[1].done).toBe(false)
  })

  it("marks the pack step done only when the coding-agent posture is present", () => {
    const steps = firstHourSteps({ ...emptySignals, codingAgentPackApplied: true })
    expect(steps[2].done).toBe(true)
    expect(steps[2].title).toMatch(/is on/)
    expect(steps[2].hint).toMatch(/asks first/)
    expect(steps[2].hint).toMatch(/not a silent merge/)
  })
})

describe("shouldShowFirstHourChecklist", () => {
  it("hides on the public demo and for signed-out demo view", () => {
    expect(shouldShowFirstHourChecklist(emptySignals, { isSession: false, isDemo: true })).toBe(false)
    expect(shouldShowFirstHourChecklist(emptySignals, { isSession: true, isDemo: true })).toBe(false)
  })

  it("shows for a signed-in wallet that has not finished the three clicks", () => {
    expect(shouldShowFirstHourChecklist(emptySignals, { isSession: true, isDemo: false })).toBe(true)
  })

  it("hides once decision, a channel, and the pack are all present", () => {
    const done: FirstHourSignals = {
      hasAgent: true,
      hasDecision: true,
      hasSlack: true,
      hasWebhook: false,
      hasGatewayUsage: false,
      codingAgentPackApplied: true,
    }
    expect(firstHourComplete(done)).toBe(true)
    expect(shouldShowFirstHourChecklist(done, { isSession: true, isDemo: false })).toBe(false)
  })
})

describe("approvalsEmptyCopy", () => {
  it("points admins with an agent at Send a test escalation, without requiring Slack", () => {
    const copy = approvalsEmptyCopy({ hasAgent: true, editable: true })
    expect(copy.title).toBe("Nothing waiting")
    expect(copy.hint).toMatch(/test escalation/i)
    expect(copy.hint).toMatch(/Slack is optional/)
  })

  it("tells viewers to log in rather than offering a dead control", () => {
    const copy = approvalsEmptyCopy({ hasAgent: true, editable: false })
    expect(copy.hint).toMatch(/Log in as an admin/)
    expect(copy.hint).toMatch(/test escalation/i)
  })

  it("sends an admin with no agent back to the roster", () => {
    const copy = approvalsEmptyCopy({ hasAgent: false, editable: true })
    expect(copy.hint).toMatch(/Add an agent on the roster/)
  })
})
