import { describe, it, expect, vi, beforeEach } from "vitest"

// KILL-1: the freeze walk — a frozen wallet or any frozen ancestor stops the
// subtree; an unfrozen chain passes; the note distinguishes self vs parent.

const { dbMock } = vi.hoisted(() => ({
  dbMock: { wallet: { findUnique: vi.fn() } },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))

import {
  walletFreezeState,
  freezeStateFromChain,
  frozenNote,
  WALLET_FROZEN_NOTE,
  PARENT_FROZEN_NOTE,
  HIERARCHY_UNVERIFIED_NOTE,
  canNestUnder,
  MAX_WALLET_CHAIN,
} from "@/lib/freeze"
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

  it("a parent cycle fails closed without hanging", async () => {
    tree([
      { id: "a", parentId: "b", frozenAt: null, frozenReason: null },
      { id: "b", parentId: "a", frozenAt: null, frozenReason: null },
    ])
    const s = await walletFreezeState(db, "a")
    expect(s).toMatchObject({ frozen: true, unverified: true })
    if (s.frozen) expect(frozenNote(s)).toBe(HIERARCHY_UNVERIFIED_NOTE)
  })

  it("a missing ancestor fails closed", async () => {
    tree([{ id: "child", parentId: "gone", frozenAt: null, frozenReason: null }])
    const s = await walletFreezeState(db, "child")
    expect(s).toMatchObject({ frozen: true, unverified: true })
    if (s.frozen) expect(frozenNote(s)).toBe(HIERARCHY_UNVERIFIED_NOTE)
  })

  it("a missing wallet fails closed", async () => {
    tree([])
    expect(await walletFreezeState(db, "nope")).toMatchObject({ frozen: true, unverified: true })
  })

  it("a chain past the depth cap fails closed; one at the cap passes", async () => {
    const chain = (n: number): Row[] =>
      Array.from({ length: n }, (_, i) => ({
        id: `w${i}`,
        parentId: i === n - 1 ? null : `w${i + 1}`,
        frozenAt: null,
        frozenReason: null,
      }))
    tree(chain(16))
    expect(await walletFreezeState(db, "w0")).toEqual({ frozen: false })
    tree(chain(17))
    expect(await walletFreezeState(db, "w0")).toMatchObject({ frozen: true, unverified: true })
  })
})

describe("freezeStateFromChain", () => {
  it("a chain that reaches a root passes", () => {
    expect(freezeStateFromChain([{ id: "c", parentId: "r" }, { id: "r", parentId: null }], "c")).toEqual({ frozen: false })
  })

  it("a truncated chain (last node still names a parent) fails closed", () => {
    const s = freezeStateFromChain([{ id: "c", parentId: "gone" }], "c")
    expect(s).toMatchObject({ frozen: true, unverified: true })
    if (s.frozen) expect(frozenNote(s)).toBe(HIERARCHY_UNVERIFIED_NOTE)
  })

  it("a frozen node still reports as a freeze, not unverified", () => {
    const s = freezeStateFromChain([{ id: "c", parentId: "p", frozenAt: new Date() }], "c")
    expect(s).toMatchObject({ frozen: true, self: true })
    if (s.frozen) expect(frozenNote(s)).toBe(WALLET_FROZEN_NOTE)
  })
})

describe("canNestUnder", () => {
  const chain = (n: number) =>
    tree(Array.from({ length: n }, (_, i) => ({ id: `w${i}`, parentId: i + 1 < n ? `w${i + 1}` : null, frozenAt: null, frozenReason: null })))

  it("allows a child whose full chain the freeze walk can still verify", async () => {
    chain(MAX_WALLET_CHAIN - 1)
    expect(await canNestUnder(db, "w0")).toBe(true)
    // ...and that child really does verify
    tree([
      ...Array.from({ length: MAX_WALLET_CHAIN - 1 }, (_, i) => ({ id: `w${i}`, parentId: i + 1 < MAX_WALLET_CHAIN - 1 ? `w${i + 1}` : null, frozenAt: null, frozenReason: null })),
      { id: "child", parentId: "w0", frozenAt: null, frozenReason: null },
    ])
    expect(await walletFreezeState(db, "child")).toEqual({ frozen: false })
  })

  it("refuses a child that would exceed the verifiable depth", async () => {
    chain(MAX_WALLET_CHAIN)
    expect(await canNestUnder(db, "w0")).toBe(false)
  })

  it("refuses a missing parent or a cycle", async () => {
    tree([{ id: "a", parentId: "b", frozenAt: null, frozenReason: null }, { id: "b", parentId: "a", frozenAt: null, frozenReason: null }])
    expect(await canNestUnder(db, "a")).toBe(false)
    expect(await canNestUnder(db, "nope")).toBe(false)
  })
})
