import { afterEach, describe, expect, it, vi } from "vitest"
import { safeNext, approvalReturnPath } from "../lib/returnPath"
import { effectiveGrantStatus } from "../lib/grantStatus"

vi.mock("../lib/db", () => ({ db: {} }))
vi.mock("next/server", () => ({ after: vi.fn() }))
vi.mock("../lib/webhooks", () => ({ deliverEvent: vi.fn() }))
import { createSpendPendingApproval } from "../lib/approvals"

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules() })

describe("approval return paths", () => {
  it.each(["//evil.test", "/\\evil.test", "/%5cevil.test", "/\t/evil.test", "https://evil.test", null])("rejects unsafe destination %s", path => {
    expect(safeNext(path)).toBe("/dashboard")
  })
  it("preserves a local decision and encodes caller-supplied identifiers", () => {
    expect(safeNext("/dashboard/approvals?review=pa_1")).toBe("/dashboard/approvals?review=pa_1")
    expect(approvalReturnPath("pa_1&next=//evil.test")).toBe("/dashboard/approvals?review=pa_1%26next%3D%2F%2Fevil.test")
  })
})

describe("effective grant status", () => {
  const now = new Date("2026-09-17T12:00:00Z")
  it("expires an active grant at its deadline without changing consumed/revoked states", () => {
    expect(effectiveGrantStatus({ status: "active", expiresAt: now }, now)).toBe("expired")
    expect(effectiveGrantStatus({ status: "active", expiresAt: new Date(now.getTime()+1) }, now)).toBe("active")
    expect(effectiveGrantStatus({ status: "consumed", consumedAt: now, expiresAt: now }, now)).toBe("consumed")
    expect(effectiveGrantStatus({ status: "revoked", expiresAt: now }, now)).toBe("revoked")
  })
})

it("persists the actual spend escalation reason and machine code", async () => {
  const create = vi.fn().mockResolvedValue({ id: "pa_1" })
  await createSpendPendingApproval({ pendingApproval: { create } } as never, {
    walletId: "wallet_1", agentName: "demo", request: { id: "r_1", agentId: "a_1", action: "purchase", amountUsd: 12, merchant: "Ads", category: "marketing", description: null, createdAt: new Date() },
    policy: { escalationTimeoutMins: 0, escalationTimeoutAction: "deny" },
    reason: "Cost per outcome over ceiling", code: "COST_PER_OUTCOME_CEILING",
  })
  expect(create).toHaveBeenCalledWith(expect.objectContaining({data: expect.objectContaining({ reason: "Cost per outcome over ceiling", code: "COST_PER_OUTCOME_CEILING" })}))
})

it("emails a tool action without inventing a charge; escapes request text", async () => {
  vi.stubEnv("RESEND_API_KEY", "test-only")
  const fetchMock = vi.fn().mockResolvedValue({ ok: true })
  vi.stubGlobal("fetch", fetchMock)
  const { sendEscalationEmail } = await import("../lib/email")
  await sendEscalationEmail("owner@example.test", { actionType: "tool.invoke", agentName: "demo", merchant: "email.send (gmail)", amountUsd: 0, category: "tool", description: "<script>bad</script>", approveUrl: "https://getsanction.com/dashboard/approvals?review=pa_1" })
  const message=JSON.parse(fetchMock.mock.calls[0][1].body)
  expect(message.subject).toBe("Approval needed: email.send (gmail)")
  expect(message.text).toContain("invoke email.send")
  expect(message.text).not.toContain("$0.00")
  expect(message.html).not.toContain("<script>")
  expect(message.html).not.toContain("charge is paused")
})

it("includes the specific policy reason alongside a spend request", async () => {
  vi.stubEnv("RESEND_API_KEY", "test-only")
  const fetchMock=vi.fn().mockResolvedValue({ok:true});vi.stubGlobal("fetch",fetchMock)
  const {sendEscalationEmail}=await import("../lib/email")
  await sendEscalationEmail("owner@example.test",{agentName:"demo",merchant:"Ads",amountUsd:12,category:"marketing",reason:"Cost per outcome over ceiling",approveUrl:"https://getsanction.com/dashboard/approvals"})
  const message=JSON.parse(fetchMock.mock.calls[0][1].body)
  expect(message.subject).toContain("$12.00")
  expect(message.text).toContain("Why approval is needed: Cost per outcome over ceiling")
  expect(message.html).toContain("Cost per outcome over ceiling")
})

it("budget emails carry wallet, agent and scope in HTML and text without asserting no requests were blocked", async () => {
  vi.stubEnv("RESEND_API_KEY", "test-only")
  const fetchMock = vi.fn().mockResolvedValue({ ok: true })
  vi.stubGlobal("fetch", fetchMock)
  const { sendBudgetThresholdEmail } = await import("../lib/email")
  await sendBudgetThresholdEmail("owner@example.test", { walletId: "pool&other=1", agent: "agent-1", scope: "daily_tokens", label: "<CI>", pctUsed: 96, spentUsd: 9.6, capUsd: 10 })
  const message = JSON.parse(fetchMock.mock.calls[0][1].body)
  const url = new URL(message.text.match(/Review the burn: (.+)/)[1])
  expect(url.searchParams.get("wallet")).toBe("pool&other=1")
  expect(url.searchParams.get("agent")).toBe("agent-1")
  expect(url.searchParams.get("budget")).toBe("daily_tokens")
  expect(message.html).toContain("&lt;CI&gt;")
  expect(message.html).toContain("wallet=pool%26other%3D1&amp;agent=agent-1&amp;budget=daily_tokens")
  expect(message.text).not.toContain("Nothing is blocked")
})
