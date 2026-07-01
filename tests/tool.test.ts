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
