import { describe, it, expect, vi, beforeEach } from "vitest"

// WALLET-MEMBERS follow-up, part 1: the dashboard's agent-creation actions
// (single + batch seat) now sit behind requireSessionRole("admin") instead
// of the bare getSessionWallet — a viewer resolves to the same null as no
// session, same denial.
const { dbMock, sessionMock, revalidateMock, redirectMock } = vi.hoisted(() => ({
  dbMock: { agent: { create: vi.fn() }, $transaction: vi.fn() },
  sessionMock: { requireSessionRole: vi.fn(), listSessionWallets: vi.fn(), setActiveWallet: vi.fn() },
  revalidateMock: vi.fn(),
  redirectMock: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`)
  }),
}))
dbMock.$transaction.mockImplementation((fn: (tx: typeof dbMock) => unknown) => fn(dbMock))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("@/lib/session", () => sessionMock)
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }))
vi.mock("next/navigation", () => ({ redirect: redirectMock }))

import { createAgentAction, createBatchAgentsAction, switchWalletAction } from "../app/dashboard/actions"

const WALLET = { id: "wallet_1" }

function form(fields: Record<string, string>) {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.agent.create.mockResolvedValue({ id: "agent_1" })
})

describe("createAgentAction — role floor", () => {
  it("denies without creating an agent when the role floor isn't met", async () => {
    sessionMock.requireSessionRole.mockResolvedValue(null)
    const res = await createAgentAction({ ok: false, error: "" }, form({ name: "runner-1" }))
    expect(res.ok).toBe(false)
    expect(dbMock.agent.create).not.toHaveBeenCalled()
  })

  it("requires admin-or-higher and creates once granted", async () => {
    sessionMock.requireSessionRole.mockResolvedValue(WALLET)
    const res = await createAgentAction({ ok: false, error: "" }, form({ name: "runner-1" }))
    expect(sessionMock.requireSessionRole).toHaveBeenCalledWith("admin")
    expect(res.ok).toBe(true)
    expect(dbMock.agent.create).toHaveBeenCalledOnce()
  })
})

describe("createBatchAgentsAction — role floor", () => {
  it("denies without minting seats when the role floor isn't met", async () => {
    sessionMock.requireSessionRole.mockResolvedValue(null)
    const res = await createBatchAgentsAction(
      { ok: false, error: "" },
      form({ count: "3", name_prefix: "seat", template_id: "contractor" }),
    )
    expect(res.ok).toBe(false)
    expect(dbMock.agent.create).not.toHaveBeenCalled()
  })
})

// WALLET-MEMBERS part 2: switching is selection, not mutation — validated
// against listSessionWallets (what the session can already reach), no role
// floor, and anything off the list is a silent no-op back to the dashboard.
describe("switchWalletAction", () => {
  it("sets the active wallet and redirects when the target is reachable", async () => {
    sessionMock.listSessionWallets.mockResolvedValue([
      { id: "wallet_1", name: "Mine", role: "owner" },
      { id: "wallet_2", name: "Theirs", role: "viewer" },
    ])
    await expect(switchWalletAction(form({ wallet_id: "wallet_2" }))).rejects.toThrow("REDIRECT:/dashboard")
    expect(sessionMock.setActiveWallet).toHaveBeenCalledWith("wallet_2")
  })

  it("ignores a wallet the session cannot reach — no cookie write, still redirects", async () => {
    sessionMock.listSessionWallets.mockResolvedValue([{ id: "wallet_1", name: "Mine", role: "owner" }])
    await expect(switchWalletAction(form({ wallet_id: "wallet_forged" }))).rejects.toThrow("REDIRECT:/dashboard")
    expect(sessionMock.setActiveWallet).not.toHaveBeenCalled()
  })

  it("a viewer membership is switchable — reachability is the only gate", async () => {
    sessionMock.listSessionWallets.mockResolvedValue([
      { id: "wallet_1", name: "Mine", role: "owner" },
      { id: "wallet_2", name: "Theirs", role: "viewer" },
    ])
    await expect(switchWalletAction(form({ wallet_id: "wallet_2" }))).rejects.toThrow("REDIRECT:/dashboard")
    expect(sessionMock.requireSessionRole).not.toHaveBeenCalled()
  })

  it("a blank wallet_id is a no-op redirect", async () => {
    await expect(switchWalletAction(form({}))).rejects.toThrow("REDIRECT:/dashboard")
    expect(sessionMock.setActiveWallet).not.toHaveBeenCalled()
    expect(sessionMock.listSessionWallets).not.toHaveBeenCalled()
  })
})
