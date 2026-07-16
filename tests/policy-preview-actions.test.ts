import { beforeEach, describe, expect, it, vi } from "vitest"

// Console parity PR2: the pack-preview / pack-apply / draft-simulate actions on
// /dashboard/policy. The load-bearing invariant is the write boundary — preview
// and simulate must be pure read+compute (runSimulation only, never a write),
// and apply is the sole path that calls applyPolicyUpdate + revalidates.
const { applyMock, simMock, sessionMock, revalidateMock } = vi.hoisted(() => ({
  applyMock: vi.fn(),
  simMock: vi.fn(),
  sessionMock: { getSessionWallet: vi.fn(), requireSessionRole: vi.fn() },
  revalidateMock: vi.fn(),
}))
vi.mock("@/lib/policy", async (orig) => {
  const mod = await orig<typeof import("@/lib/policy")>()
  return { ...mod, applyPolicyUpdate: applyMock }
})
vi.mock("@/lib/simulationRun", () => ({ runSimulation: simMock }))
vi.mock("@/lib/session", () => sessionMock)
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }))

import {
  applyPackAction,
  previewPackAction,
  simulateDraftAction,
} from "../app/dashboard/policy/actions"

const REPORT = { state: "as_recorded", counts: { considered: 3 } } as never

function form(entries: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(entries)) f.set(k, v)
  return f
}

// A full editor submission, mirroring the save-form shape.
const DRAFT = form({
  daily_token_budget_usd: "50",
  daily_spend_budget_usd: "200",
  per_transaction_max_usd: "500",
  auto_approve_under_usd: "5",
  escalate_over_usd: "50",
  allowed_categories: "software",
  blocked_categories: "gambling",
  allowed_tools: "shell.exec",
  blocked_tools: "",
  escalate_tools: "",
  capability_rules: "[]",
  escalation_timeout_mins: "240",
  escalation_timeout_action: "deny",
})

beforeEach(() => {
  vi.clearAllMocks()
  sessionMock.getSessionWallet.mockResolvedValue({ id: "wallet_1" })
  sessionMock.requireSessionRole.mockResolvedValue({ id: "wallet_1" })
  applyMock.mockResolvedValue({ ok: true, policy: {} })
  simMock.mockResolvedValue(REPORT)
})

describe("previewPackAction", () => {
  it("simulates a known pack without writing", async () => {
    const res = await previewPackAction({ ok: false, message: "" }, form({ pack_id: "startup-defaults" }))
    expect(res.ok).toBe(true)
    expect(res.report).toBe(REPORT)
    expect(res.packName).toBe("Startup defaults")
    expect(simMock).toHaveBeenCalledTimes(1)
    expect(simMock.mock.calls[0][0]).toBe("wallet_1")
    // read-only: no write, no revalidate
    expect(applyMock).not.toHaveBeenCalled()
    expect(revalidateMock).not.toHaveBeenCalled()
  })

  it("rejects an unknown pack without simulating", async () => {
    const res = await previewPackAction({ ok: false, message: "" }, form({ pack_id: "nope" }))
    expect(res.ok).toBe(false)
    expect(simMock).not.toHaveBeenCalled()
  })

  it("fails closed with no simulation when there is no session", async () => {
    sessionMock.getSessionWallet.mockResolvedValue(null)
    const res = await previewPackAction({ ok: false, message: "" }, form({ pack_id: "startup-defaults" }))
    expect(res.ok).toBe(false)
    expect(simMock).not.toHaveBeenCalled()
  })
})

describe("applyPackAction", () => {
  it("is the write path: applyPolicyUpdate with the pack policy + revalidate", async () => {
    const res = await applyPackAction({ ok: false, message: "" }, form({ pack_id: "startup-defaults" }))
    expect(res.ok).toBe(true)
    expect(applyMock).toHaveBeenCalledTimes(1)
    expect(applyMock.mock.calls[0][0]).toBe("wallet_1")
    // the pack's own policy is forwarded (a coherent baseline, not a patch)
    expect(applyMock.mock.calls[0][1].auto_approve_under_usd).toBe(5)
    expect(revalidateMock).toHaveBeenCalledWith("/dashboard/policy")
    expect(revalidateMock).toHaveBeenCalledWith("/dashboard/spend")
    expect(revalidateMock).toHaveBeenCalledWith("/dashboard")
  })

  it("rejects an unknown pack without writing", async () => {
    const res = await applyPackAction({ ok: false, message: "" }, form({ pack_id: "nope" }))
    expect(res.ok).toBe(false)
    expect(applyMock).not.toHaveBeenCalled()
  })

  it("fails closed with no write when there is no session", async () => {
    sessionMock.requireSessionRole.mockResolvedValue(null)
    const res = await applyPackAction({ ok: false, message: "" }, form({ pack_id: "startup-defaults" }))
    expect(res.ok).toBe(false)
    expect(applyMock).not.toHaveBeenCalled()
    expect(revalidateMock).not.toHaveBeenCalled()
  })

  // A viewer member also resolves to null (the WALLET-MEMBERS role floor
  // lives in lib/session.ts's requireSessionRole) — same denial as no session.
  it("refuses a viewer member the same way as no session", async () => {
    sessionMock.requireSessionRole.mockResolvedValue(null)
    const res = await applyPackAction({ ok: false, message: "" }, form({ pack_id: "startup-defaults" }))
    expect(res.ok).toBe(false)
    expect(applyMock).not.toHaveBeenCalled()
    expect(sessionMock.requireSessionRole).toHaveBeenCalledWith("admin")
  })

  it("surfaces an applyPolicyUpdate failure as an error state", async () => {
    applyMock.mockResolvedValue({ ok: false, error: "Invalid policy" })
    const res = await applyPackAction({ ok: false, message: "" }, form({ pack_id: "startup-defaults" }))
    expect(res).toEqual({ ok: false, message: "Invalid policy" })
    expect(revalidateMock).not.toHaveBeenCalled()
  })
})

describe("simulateDraftAction", () => {
  it("simulates the parsed draft without writing", async () => {
    const res = await simulateDraftAction({ ok: false, message: "" }, DRAFT)
    expect(res.ok).toBe(true)
    expect(res.report).toBe(REPORT)
    const [walletId, input] = simMock.mock.calls[0]
    expect(walletId).toBe("wallet_1")
    // tools stay case-sensitive; categories lowercased — same parse as save
    expect(input.allowed_tools).toEqual(["shell.exec"])
    expect(input.blocked_categories).toEqual(["gambling"])
    expect(applyMock).not.toHaveBeenCalled()
    expect(revalidateMock).not.toHaveBeenCalled()
  })

  it("rejects a malformed capability payload before simulating", async () => {
    const bad = form({ ...Object.fromEntries(DRAFT), capability_rules: "not json" })
    const res = await simulateDraftAction({ ok: false, message: "" }, bad)
    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/capability/i)
    expect(simMock).not.toHaveBeenCalled()
  })

  it("fails closed with no simulation when there is no session", async () => {
    sessionMock.getSessionWallet.mockResolvedValue(null)
    const res = await simulateDraftAction({ ok: false, message: "" }, DRAFT)
    expect(res.ok).toBe(false)
    expect(simMock).not.toHaveBeenCalled()
  })
})
