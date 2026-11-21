import { describe, expect, it } from "vitest"
import { actionLabel, asRecord, kindLabel, numberValue, resourceTitle, stringValue } from "../lib/approvalTitle"

describe("approval titles", () => {
  it("names a spend by amount and merchant", () => {
    expect(resourceTitle({ kind: "spend", amount_usd: 1250, merchant: "Google Ads" }, "spend.purchase")).toBe("$1,250.00 Google Ads")
    expect(resourceTitle({ kind: "spend", merchant: "Datadog" }, "spend.purchase")).toBe("Datadog")
    expect(resourceTitle({ kind: "spend", amount_usd: 5 }, "spend.purchase")).toBe("$5.00 Unknown merchant")
  })

  it("names a provision by quantity, item, amount and resource", () => {
    expect(resourceTitle({ kind: "provision", quantity: 2, line_item: "GPU hours", amount_usd: 90, resource: "aws" }, "provision.allocate"))
      .toBe("2 × GPU hours — $90.00 (aws)")
    expect(resourceTitle({ kind: "provision" }, "provision.allocate")).toBe("Unknown item")
  })

  it("names anything else by its label, tool or action", () => {
    expect(resourceTitle({ kind: "tool", tool: "claude-code.Bash", label: "git push origin main" }, "tool.invoke")).toBe("git push origin main")
    expect(resourceTitle({ kind: "tool", tool: "claude-code.Bash" }, "tool.invoke")).toBe("claude-code.Bash")
    expect(resourceTitle({ credential_label: "stripe-live" }, "credential.inject")).toBe("stripe-live")
    expect(resourceTitle({}, "capability.use")).toBe("Capability Use")
  })

  it("reads loosely typed JSON without trusting it", () => {
    expect(asRecord(null)).toEqual({})
    expect(asRecord(["a"])).toEqual({})
    expect(asRecord({ a: 1 })).toEqual({ a: 1 })
    expect(stringValue("  ")).toBeNull()
    expect(stringValue("x")).toBe("x")
    expect(numberValue(Number.NaN)).toBeNull()
    expect(numberValue(3)).toBe(3)
    expect(actionLabel("tool.invoke")).toBe("Tool Invoke")
  })

  it("names the kind of request in plain words", () => {
    expect(kindLabel({ kind: "spend" }, "spend.purchase")).toBe("Purchase")
    expect(kindLabel({ kind: "provision" }, "provision.allocate")).toBe("Provision")
    expect(kindLabel({ kind: "tool" }, "tool.invoke")).toBe("Tool call")
    expect(kindLabel({ kind: "capability" }, "capability.use")).toBe("New capability")
    expect(kindLabel({}, "credential.inject")).toBe("Credential Inject")
  })
})
