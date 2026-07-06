import { beforeEach, describe, expect, it, vi } from "vitest"

// Console parity PR1: the full-policy dashboard action. It must (1) parse tools
// as arrays without lowercasing, (2) JSON.parse the capability-rule hidden
// input, (3) forward the previously-omitted fields (monthly, timeout), (4) fail
// closed with no write on no-session and on an invalid capability payload.
const { applyMock, sessionMock, revalidateMock } = vi.hoisted(() => ({
  applyMock: vi.fn(),
  sessionMock: { getSessionWallet: vi.fn() },
  revalidateMock: vi.fn(),
}))
vi.mock("@/lib/policy", async (orig) => {
  const mod = await orig<typeof import("@/lib/policy")>()
  return { ...mod, applyPolicyUpdate: applyMock }
})
vi.mock("@/lib/session", () => sessionMock)
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }))

import { updatePolicyAction } from "../app/dashboard/policy/actions"

function form(entries: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(entries)) f.set(k, v)
  return f
}

const FULL = {
  daily_token_budget_usd: "50",
  daily_spend_budget_usd: "200",
  monthly_spend_budget_usd: "1500",
  subtree_daily_cap_usd: "100",
  per_transaction_max_usd: "500",
  auto_approve_under_usd: "5",
  escalate_over_usd: "50",
  allowed_categories: "Software, Services",
  blocked_categories: "gambling",
  allowed_tools: "GitHub.Create_Deployment, shell.exec",
  blocked_tools: "email.send",
  escalate_tools: "deploy.prod",
  capability_rules: '[{"pattern":"skill:install:*","effect":"escalate"}]',
  escalation_timeout_mins: "240",
  escalation_timeout_action: "deny",
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionMock.getSessionWallet.mockResolvedValue({ id: "wallet_1" })
  applyMock.mockResolvedValue({ ok: true, policy: {} })
})

describe("updatePolicyAction", () => {
  it("forwards all 15 fields: tools stay case-sensitive, categories lowercased, capability rules parsed", async () => {
    const res = await updatePolicyAction({ ok: false, message: "" }, form(FULL))
    expect(res.ok).toBe(true)
    const [walletId, input] = applyMock.mock.calls[0]
    expect(walletId).toBe("wallet_1")
    // tools are namespaced/case-sensitive — NOT lowercased
    expect(input.allowed_tools).toEqual(["GitHub.Create_Deployment", "shell.exec"])
    // categories lowercased
    expect(input.allowed_categories).toEqual(["software", "services"])
    // capability rules parsed from the hidden JSON input
    expect(input.capability_rules).toEqual([{ pattern: "skill:install:*", effect: "escalate" }])
    // previously-omitted fields forwarded
    expect(input.monthly_spend_budget_usd).toBe(1500)
    expect(input.subtree_daily_cap_usd).toBe(100)
    expect(input.escalation_timeout_mins).toBe(240)
    expect(input.escalation_timeout_action).toBe("deny")
    expect(revalidateMock).toHaveBeenCalledWith("/dashboard/policy")
    expect(revalidateMock).toHaveBeenCalledWith("/dashboard/spend")
  })

  it("leaves a cleared numeric field unchanged (undefined), never forces it to $0", async () => {
    await updatePolicyAction({ ok: false, message: "" }, form({ ...FULL, per_transaction_max_usd: "" }))
    const input = applyMock.mock.calls[0][1]
    // undefined → applyPolicyUpdate skips it → prior guardrail preserved.
    expect(input.per_transaction_max_usd).toBeUndefined()
  })

  it("treats an empty capability_rules array as a valid 'clear all rules' state", async () => {
    await updatePolicyAction({ ok: false, message: "" }, form({ ...FULL, capability_rules: "[]" }))
    expect(applyMock.mock.calls[0][1].capability_rules).toEqual([])
  })

  it("fails closed with no write when there is no session", async () => {
    sessionMock.getSessionWallet.mockResolvedValue(null)
    const res = await updatePolicyAction({ ok: false, message: "" }, form(FULL))
    expect(res.ok).toBe(false)
    expect(applyMock).not.toHaveBeenCalled()
    expect(revalidateMock).not.toHaveBeenCalled()
  })

  it("rejects a malformed capability payload before writing", async () => {
    const res = await updatePolicyAction({ ok: false, message: "" }, form({ ...FULL, capability_rules: "not json" }))
    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/capability/i)
    expect(applyMock).not.toHaveBeenCalled()
  })

  it("surfaces a validation failure from applyPolicyUpdate as an error state", async () => {
    applyMock.mockResolvedValue({ ok: false, error: "Invalid policy" })
    const res = await updatePolicyAction({ ok: false, message: "" }, form(FULL))
    expect(res).toEqual({ ok: false, message: "Invalid policy" })
    expect(revalidateMock).not.toHaveBeenCalled()
  })
})
