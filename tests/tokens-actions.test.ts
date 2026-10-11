import { describe, it, expect, vi, beforeEach } from "vitest"

// WALLET-MEMBERS follow-up, part 1: tokens/actions.ts's revoke now sits
// behind requireSessionRole("admin") instead of the bare getSessionWallet —
// a viewer resolves to the same null as no session, same denial.
const { dbMock, sessionMock, revalidateMock } = vi.hoisted(() => ({
  dbMock: { executionToken: { updateMany: vi.fn() }, $transaction: vi.fn(), $executeRaw: vi.fn() },
  sessionMock: { requireSessionRole: vi.fn() },
  revalidateMock: vi.fn(),
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("@/lib/session", () => sessionMock)
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }))

import { revokeExecutionTokenAction } from "../app/dashboard/tokens/actions"

const WALLET = { id: "wallet_1" }

function form(fields: Record<string, string>) {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.$transaction.mockImplementation(async (fn: (tx: typeof dbMock) => unknown) => fn(dbMock))
})

describe("revokeExecutionTokenAction — role floor", () => {
  it("denies without touching the db when the role floor isn't met", async () => {
    sessionMock.requireSessionRole.mockResolvedValue(null)
    await revokeExecutionTokenAction(form({ id: "tok_1" }))
    expect(dbMock.executionToken.updateMany).not.toHaveBeenCalled()
    expect(dbMock.$transaction).not.toHaveBeenCalled()
  })

  it("requires admin-or-higher and revokes an active token once granted", async () => {
    sessionMock.requireSessionRole.mockResolvedValue(WALLET)
    await revokeExecutionTokenAction(form({ id: "tok_1" }))
    expect(sessionMock.requireSessionRole).toHaveBeenCalledWith("admin")
    expect(dbMock.$executeRaw.mock.calls[0][1]).toBe(WALLET.id)
    expect(dbMock.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(dbMock.executionToken.updateMany.mock.invocationCallOrder[0])
    expect(dbMock.executionToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "tok_1", walletId: WALLET.id, status: "active" }, data: expect.objectContaining({ status: "revoked" }) }),
    )
  })
})
