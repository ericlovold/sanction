import { describe, expect, it, vi } from "vitest"

import { agentIsInWalletSet, walletIsInSubtree, walletSubtreeIds } from "../lib/poolAccess"

type WalletRow = { id: string; parentId: string | null }
type AgentRow = { id: string; walletId: string; name: string }
type StringFilter = string | null | { in?: string[]; notIn?: string[]; not?: StringFilter }
type WalletWhere = { id?: StringFilter; parentId?: StringFilter; OR?: WalletWhere[]; AND?: WalletWhere[] }
type AgentWhere = { id?: StringFilter; walletId?: StringFilter; OR?: AgentWhere[]; AND?: AgentWhere[] }

const wallet = (id: string, parentId: string | null): WalletRow => ({ id, parentId })
const agent = (id: string, walletId: string): AgentRow => ({ id, walletId, name: id })

function matchesString(value: string | null, filter?: StringFilter): boolean {
  if (filter === undefined) return true
  if (filter === null || typeof filter === "string") return value === filter
  if (filter.in && !filter.in.includes(value ?? "")) return false
  if (filter.notIn && filter.notIn.includes(value ?? "")) return false
  if (filter.not !== undefined && matchesString(value, filter.not)) return false
  return true
}

function matchesWallet(row: WalletRow, where?: WalletWhere): boolean {
  if (!where) return true
  if (where.OR && !where.OR.some((clause) => matchesWallet(row, clause))) return false
  if (where.AND && !where.AND.every((clause) => matchesWallet(row, clause))) return false
  return matchesString(row.id, where.id) && matchesString(row.parentId, where.parentId)
}

function matchesAgent(row: AgentRow, where?: AgentWhere): boolean {
  if (!where) return true
  if (where.OR && !where.OR.some((clause) => matchesAgent(row, clause))) return false
  if (where.AND && !where.AND.every((clause) => matchesAgent(row, clause))) return false
  return matchesString(row.id, where.id) && matchesString(row.walletId, where.walletId)
}

function selectRow<T extends Record<string, unknown>>(row: T, select?: Record<string, unknown>): T | Record<string, unknown> {
  if (!select) return row

  const selected: Record<string, unknown> = {}
  for (const [key, enabled] of Object.entries(select)) {
    if (enabled === true && key in row) selected[key] = row[key]
  }
  return Object.keys(selected).length ? selected : row
}

function txMock(wallets: WalletRow[], agents: AgentRow[] = []) {
  const findWallet = async (args?: { where?: WalletWhere; select?: Record<string, unknown> }) => {
    const row = wallets.find((candidate) => matchesWallet(candidate, args?.where)) ?? null
    return row ? selectRow(row, args?.select) : null
  }
  const findWallets = async (args?: { where?: WalletWhere; select?: Record<string, unknown> }) => {
    return wallets.filter((row) => matchesWallet(row, args?.where)).map((row) => selectRow(row, args?.select))
  }
  const findAgent = async (args?: { where?: AgentWhere; select?: Record<string, unknown> }) => {
    const row = agents.find((candidate) => matchesAgent(candidate, args?.where)) ?? null
    return row ? selectRow(row, args?.select) : null
  }

  return {
    wallet: {
      findUnique: vi.fn(findWallet),
      findFirst: vi.fn(findWallet),
      findMany: vi.fn(findWallets),
    },
    agent: {
      findUnique: vi.fn(findAgent),
      findFirst: vi.fn(findAgent),
    },
  }
}

function expectIds(actual: Iterable<string>, expected: string[]) {
  const ids = Array.from(actual)
  expect(ids).toHaveLength(expected.length)
  expect(new Set(ids)).toEqual(new Set(expected))
}

describe("walletSubtreeIds", () => {
  it("includes the root wallet", async () => {
    const tx = txMock([wallet("root", null)])

    expectIds(await walletSubtreeIds(tx as never, "root"), ["root"])
  })

  it("returns descendants across multiple levels without unrelated roots", async () => {
    const tx = txMock([
      wallet("root", null),
      wallet("sales", "root"),
      wallet("sales-east", "sales"),
      wallet("sales-east-1", "sales-east"),
      wallet("finance", "root"),
      wallet("external", null),
      wallet("external-child", "external"),
    ])

    expectIds(await walletSubtreeIds(tx as never, "root"), [
      "root",
      "sales",
      "sales-east",
      "sales-east-1",
      "finance",
    ])
  })

  it("returns an empty subtree when the root wallet is missing", async () => {
    const tx = txMock([wallet("candidate", null)])

    expectIds(await walletSubtreeIds(tx as never, "missing"), [])
  })

  it("is cycle-safe and never returns a wallet twice", async () => {
    const tx = txMock([
      wallet("root", "grandchild"),
      wallet("child", "root"),
      wallet("grandchild", "child"),
    ])
    const ids = await walletSubtreeIds(tx as never, "root")

    expectIds(ids, ["root", "child", "grandchild"])
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe("walletIsInSubtree", () => {
  it("accepts the root and descendants but excludes siblings", async () => {
    const tx = txMock([
      wallet("root", null),
      wallet("sales", "root"),
      wallet("sales-east", "sales"),
      wallet("finance", "root"),
    ])

    await expect(walletIsInSubtree(tx as never, "sales", "sales")).resolves.toBe(true)
    await expect(walletIsInSubtree(tx as never, "sales", "sales-east")).resolves.toBe(true)
    await expect(walletIsInSubtree(tx as never, "sales", "finance")).resolves.toBe(false)
  })

  it("rejects missing roots and missing candidates", async () => {
    const tx = txMock([wallet("root", null), wallet("child", "root")])

    await expect(walletIsInSubtree(tx as never, "missing", "missing")).resolves.toBe(false)
    await expect(walletIsInSubtree(tx as never, "root", "missing")).resolves.toBe(false)
  })
})

describe("agentIsInWalletSet", () => {
  it("returns the agent when its wallet is allowed", async () => {
    const tx = txMock([], [agent("agent_sales", "sales")])

    await expect(agentIsInWalletSet(tx as never, "agent_sales", ["root", "sales"])).resolves.toMatchObject({
      id: "agent_sales",
      walletId: "sales",
    })
  })

  it("returns null when the agent is outside the allowed wallets or missing", async () => {
    const tx = txMock([], [agent("agent_sales", "sales"), agent("agent_external", "external")])

    await expect(agentIsInWalletSet(tx as never, "agent_external", ["root", "sales"])).resolves.toBeNull()
    await expect(agentIsInWalletSet(tx as never, "missing", ["root", "sales"])).resolves.toBeNull()
    await expect(agentIsInWalletSet(tx as never, "agent_sales", [])).resolves.toBeNull()
  })
})
