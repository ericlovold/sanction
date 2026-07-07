import { describe, it, expect, vi, beforeEach } from "vitest"

// KILL-1: the freeze walk — a frozen wallet or any frozen ancestor stops the
// subtree; an unfrozen chain passes; the note distinguishes self vs parent.

const { dbMock } = vi.hoisted(() => ({
  dbMock: { wallet: { findUnique: vi.fn() } },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))

import { walletFreezeState, frozenNote, WALLET_FROZEN_NOTE, PARENT_FROZEN_NOTE } from "@/lib/freeze"
import { db } from "@/lib/db" // the mock above, typed as the real client

type Row = { id: string; parentId: string | null; frozenAt: Date | null; frozenReason: string | null }

function tree(rows: Row[]) {
  const byId = new Map(rows.map((r) => [r.id, r]))
  dbMock.wallet.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => byId.get(where.id) ?? null)
}

beforeEach(() => vi.clearAllMocks())

describe("walletFreezeState", () => {
  it("unfrozen chain passes", async () => {
    tree([
      { id: "root", parentId: null, frozenAt: null, frozenReason: null },
      { id: "child", parentId: "root", frozenAt: null, frozenReason: null },
    ])
    expect(await walletFreezeState(db, "child")).toEqual({ frozen: false })
  })

  it("a frozen wallet blocks itself, with its reason", async () => {
    tree([{ id: "w", parentId: null, frozenAt: new Date(), frozenReason: "incident" }])
    const s = await walletFreezeState(db, "w")
    expect(s).toMatchObject({ frozen: true, frozenWalletId: "w", self: true, reason: "incident" })
    if (s.frozen) expect(frozenNote(s)).toBe(WALLET_FROZEN_NOTE)
  })

  it("a frozen ancestor blocks the whole subtree — the CFO kill-switch", async () => {
    tree([
      { id: "org", parentId: null, frozenAt: new Date(), frozenReason: null },
      { id: "channel", parentId: "org", frozenAt: null, frozenReason: null },
      { id: "agent-pool", parentId: "channel", frozenAt: null, frozenReason: null },
    ])
    const s = await walletFreezeState(db, "agent-pool")
    expect(s).toMatchObject({ frozen: true, frozenWalletId: "org", self: false })
    if (s.frozen) expect(frozenNote(s)).toBe(PARENT_FROZEN_NOTE)
  })

  it("survives a parent cycle without hanging", async () => {
    tree([
      { id: "a", parentId: "b", frozenAt: null, frozenReason: null },
      { id: "b", parentId: "a", frozenAt: null, frozenReason: null },
    ])
    expect(await walletFreezeState(db, "a")).toEqual({ frozen: false })
  })
})
