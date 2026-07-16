import { describe, it, expect, vi, beforeEach } from "vitest"

// WALLET-MEMBERS follow-up, part 1: the dashboard's agent-creation actions
// (single + batch seat) now sit behind requireSessionRole("admin") instead
// of the bare getSessionWallet — a viewer resolves to the same null as no
// session, same denial.
const { dbMock, sessionMock, revalidateMock } = vi.hoisted(() => ({
  dbMock: { agent: { create: vi.fn() }, $transaction: vi.fn() },
  sessionMock: { requireSessionRole: vi.fn() },
  revalidateMock: vi.fn(),
}))
dbMock.$transaction.mockImplementation((fn: (tx: typeof dbMock) => unknown) => fn(dbMock))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("@/lib/session", () => sessionMock)
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }))

import { createAgentAction, createBatchAgentsAction } from "../app/dashboard/actions"

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
