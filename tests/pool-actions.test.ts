import { beforeEach, describe, expect, it, vi } from "vitest"

type MockFn = ReturnType<typeof vi.fn>
type StringFilter = string | { in?: string[] }
type NullableStringFilter = string | { in?: Array<string | null> }
type DbArgs = {
  where?: {
    agentId?: string
    id?: StringFilter
    parentId?: NullableStringFilter
    walletId?: StringFilter
  }
  create?: Record<string, unknown>
  data?: Record<string, unknown>
  update?: Record<string, unknown>
}
type DbMock = {
  $transaction: MockFn
  agent: Record<"findFirst" | "findMany" | "findUnique" | "update", MockFn>
  agentClearance: Record<"findFirst" | "findUnique" | "update" | "updateMany", MockFn>
  authorizationRequest: Record<"groupBy", MockFn>
  policy: Record<"upsert", MockFn>
  policyRevision: Record<"create", MockFn>
  wallet: Record<"count" | "create" | "findFirst" | "findMany" | "findUnique", MockFn>
}
type TransactionArg = ((client: DbMock) => unknown) | Promise<unknown>[]
type WalletCreateData = {
  policy?: {
    create?: {
      subtreeDailyCapUsd?: number | null
    }
  }
}

const { apiKeyMock, dbMock, revalidatePathMock, sessionMock } = vi.hoisted(() => {
  const db: DbMock = {
    $transaction: vi.fn(),
    wallet: {
      count: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    policy: {
      upsert: vi.fn(),
    },
    policyRevision: {
      create: vi.fn(),
    },
    agent: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    agentClearance: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    authorizationRequest: {
      groupBy: vi.fn(),
    },
  }
  db.$transaction.mockImplementation((arg: TransactionArg) =>
    typeof arg === "function" ? arg(db) : Promise.all(arg),
  )

  return {
    apiKeyMock: {
      generateManagementKey: vi.fn(),
    },
    dbMock: db,
    revalidatePathMock: vi.fn(),
    sessionMock: {
      requireSessionRole: vi.fn(),
    },
  }
})

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }))
vi.mock("../lib/apiKey", () => apiKeyMock)
vi.mock("@/lib/apiKey", () => apiKeyMock)
vi.mock("../lib/db", () => ({ db: dbMock }))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("../lib/session", () => sessionMock)
vi.mock("@/lib/session", () => sessionMock)

import {
  applyPoolAllocationAction,
  createDelegatedPoolAction,
  moveAgentToPoolAction,
  updatePoolCapAction,
} from "../app/dashboard/pools/actions"

const rootWallet = { id: "wallet_root", name: "Acme", parentId: null, policy: { subtreeDailyCapUsd: 10_000, dailySpendBudgetUsd: 10_000 } }

const wallets = [
  rootWallet,
  { id: "pool_child", name: "Research", parentId: "wallet_root", policy: { subtreeDailyCapUsd: null, dailySpendBudgetUsd: 10_000 } },
  { id: "pool_support", name: "Support", parentId: "wallet_root", policy: { subtreeDailyCapUsd: null, dailySpendBudgetUsd: 10_000 } },
  { id: "pool_grandchild", name: "Red Team", parentId: "pool_child", policy: { subtreeDailyCapUsd: null, dailySpendBudgetUsd: 10_000 } },
  { id: "wallet_foreign", name: "Other Co", parentId: null },
  { id: "pool_foreign", name: "Other Pool", parentId: "wallet_foreign" },
]

const agents = [
  { id: "agent_child", name: "Analyst", walletId: "pool_child", isActive: true, dailySpendBudgetUsd: 8_000, clearance: { id: "clearance_1", walletId: "pool_child" } },
  { id: "agent_support", name: "Helper", walletId: "pool_support", isActive: true, dailySpendBudgetUsd: 2_000, clearance: { id: "clearance_2", walletId: "pool_support" } },
  { id: "agent_foreign", name: "Intruder", walletId: "pool_foreign", isActive: true, dailySpendBudgetUsd: 50_000, clearance: null },
]

function form(entries: Record<string, string>) {
  const f = new FormData()
  for (const [key, value] of Object.entries(entries)) f.set(key, value)
  return f
}

function stateMessage(result: { message?: string; error?: string }) {
  return result.message ?? result.error ?? ""
}

function dbArgs(args: unknown) {
  return (args ?? {}) as DbArgs
}

function stringValue(value: StringFilter | NullableStringFilter | undefined) {
  return typeof value === "string" ? value : undefined
}

function inValues(value: StringFilter | NullableStringFilter | undefined) {
  return typeof value === "object" && value !== null ? value.in : undefined
}

function matchingWallet(id: string | undefined) {
  return wallets.find((wallet) => wallet.id === id) ?? null
}

function setupWalletLookups() {
  dbMock.wallet.findUnique.mockImplementation(async (args: unknown) => matchingWallet(stringValue(dbArgs(args).where?.id)))

  dbMock.wallet.findFirst.mockImplementation(async (args: unknown) => {
    const id = stringValue(dbArgs(args).where?.id)
    if (id) return matchingWallet(id)
    return null
  })

  dbMock.wallet.findMany.mockImplementation(async (args: unknown) => {
    const where = dbArgs(args).where ?? {}
    const parentIn = inValues(where.parentId)
    if (Array.isArray(parentIn)) return wallets.filter((wallet) => parentIn.includes(wallet.parentId))
    if (typeof where.parentId === "string") return wallets.filter((wallet) => wallet.parentId === where.parentId)
    const idIn = inValues(where.id)
    if (Array.isArray(idIn)) return wallets.filter((wallet) => idIn.includes(wallet.id))
    return wallets
  })

  dbMock.wallet.count.mockImplementation(async (args: unknown) => {
    const id = stringValue(dbArgs(args).where?.id)
    return matchingWallet(id) ? 1 : 0
  })
}

function setupAgentLookups() {
  const findAgent = (id: string | undefined) => agents.find((agent) => agent.id === id) ?? null

  dbMock.agent.findUnique.mockImplementation(async (args: unknown) => findAgent(stringValue(dbArgs(args).where?.id)))
  dbMock.agent.findFirst.mockImplementation(async (args: unknown) => findAgent(stringValue(dbArgs(args).where?.id)))
  dbMock.agent.findMany.mockImplementation(async (args: unknown) => {
    const walletIds = inValues(dbArgs(args).where?.walletId)
    if (Array.isArray(walletIds)) return agents.filter((agent) => walletIds.includes(agent.walletId))
    return agents
  })
  dbMock.agent.update.mockImplementation(async (args: unknown) => ({
    ...findAgent(stringValue(dbArgs(args).where?.id)),
    ...dbArgs(args).data,
  }))

  dbMock.agentClearance.findUnique.mockImplementation(async (args: unknown) => {
    const agentId = dbArgs(args).where?.agentId
    return findAgent(agentId)?.clearance ?? null
  })
  dbMock.agentClearance.findFirst.mockImplementation(async (args: unknown) => {
    const agentId = dbArgs(args).where?.agentId
    return findAgent(agentId)?.clearance ?? null
  })
  dbMock.agentClearance.update.mockImplementation(async (args: unknown) => ({
    id: dbArgs(args).where?.id ?? "clearance_1",
    ...dbArgs(args).data,
  }))
  dbMock.agentClearance.updateMany.mockResolvedValue({ count: 1 })
}

function policyCapWritten() {
  const walletCreateData = dbArgs(dbMock.wallet.create.mock.calls.at(-1)?.[0]).data as WalletCreateData | undefined
  const nestedCap = walletCreateData?.policy?.create?.subtreeDailyCapUsd
  if (nestedCap !== undefined) return nestedCap

  const upsertArg = dbArgs(dbMock.policy.upsert.mock.calls.at(-1)?.[0])
  return upsertArg?.update?.subtreeDailyCapUsd ?? upsertArg?.create?.subtreeDailyCapUsd
}

function revalidatedPaths() {
  return revalidatePathMock.mock.calls.map(([path]) => path)
}

beforeEach(() => {
  vi.clearAllMocks()
  setupWalletLookups()
  setupAgentLookups()

  sessionMock.requireSessionRole.mockResolvedValue(rootWallet)
  apiKeyMock.generateManagementKey.mockReturnValue({
    raw: "sk_pool_once",
    hash: "hash_pool_once",
    prefix: "sk_pool_on",
  })
  dbMock.wallet.create.mockResolvedValue({
    id: "pool_new",
    name: "Research",
    parentId: "wallet_root",
    mgmtKeyHash: "hash_pool_once",
    mgmtKeyPrefix: "sk_pool_on",
  })
  dbMock.policy.upsert.mockImplementation(async (args: unknown) => {
    const parsed = dbArgs(args)
    return { walletId: parsed.where?.walletId, ...parsed.create, ...parsed.update }
  })
  dbMock.authorizationRequest.groupBy.mockResolvedValue([
    { agentId: "agent_child", _sum: { amountUsd: 20 } },
    { agentId: "agent_support", _sum: { amountUsd: 5 } },
  ])
})

describe("createDelegatedPoolAction", () => {
  it("rejects anonymous dashboard mutations without creating a pool", async () => {
    sessionMock.requireSessionRole.mockResolvedValueOnce(null)

    const result = await createDelegatedPoolAction(
      { ok: false, message: "" },
      form({ name: "Research", owner_email: "research@acme.test", subtree_daily_cap_usd: "125" }),
    )

    expect(result.ok).toBe(false)
    expect(stateMessage(result)).toMatch(/log in|authorized/i)
    expect(dbMock.wallet.create).not.toHaveBeenCalled()
    expect(dbMock.policy.upsert).not.toHaveBeenCalled()
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })

  // A viewer member also resolves to null here (the WALLET-MEMBERS role floor
  // lives in lib/session.ts's requireSessionRole) — same denial as no session.
  it("rejects a viewer member the same way as no session", async () => {
    sessionMock.requireSessionRole.mockResolvedValueOnce(null)

    const result = await createDelegatedPoolAction(
      { ok: false, message: "" },
      form({ name: "Research", owner_email: "research@acme.test", subtree_daily_cap_usd: "125" }),
    )

    expect(result.ok).toBe(false)
    expect(dbMock.wallet.create).not.toHaveBeenCalled()
    expect(sessionMock.requireSessionRole).toHaveBeenCalledWith("admin")
  })

  it("creates a direct child pool, stores only the management-key hash, writes cap cents, and revalidates pools", async () => {
    const result = await createDelegatedPoolAction(
      { ok: false, message: "" },
      form({
        name: "  Research  ",
        owner_email: "research@acme.test",
        parent_id: "pool_foreign",
        subtree_daily_cap_usd: "123.45",
      }),
    )

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        message: "Pool created",
        managementKey: "sk_pool_once",
        poolName: "Research",
      }),
    )
    expect(apiKeyMock.generateManagementKey).toHaveBeenCalledOnce()

    const createArg = dbMock.wallet.create.mock.calls[0][0]
    expect(createArg.data).toEqual(
      expect.objectContaining({
        name: "Research",
        ownerEmail: "research@acme.test",
        parentId: "wallet_root",
        mgmtKeyHash: "hash_pool_once",
        mgmtKeyPrefix: "sk_pool_on",
      }),
    )
    expect(JSON.stringify(createArg.data)).not.toContain("sk_pool_once")
    expect(policyCapWritten()).toBe(12345)
    expect(revalidatedPaths()).toEqual(expect.arrayContaining(["/dashboard", "/dashboard/pools"]))
  })
})

describe("updatePoolCapAction", () => {
  it("updates a descendant pool cap in cents", async () => {
    const result = await updatePoolCapAction(
      { ok: false, message: "" },
      form({
        wallet_id: "pool_grandchild",
        pool_id: "pool_grandchild",
        subtree_daily_cap_usd: "19.99",
      }),
    )

    expect(result).toEqual(expect.objectContaining({ ok: true, message: "Pool cap saved" }))
    expect(dbMock.policy.upsert).toHaveBeenCalledWith({
      where: { walletId: "pool_grandchild" },
      update: { subtreeDailyCapUsd: 1999, currentRevision: { increment: 1 } },
      create: { walletId: "pool_grandchild", subtreeDailyCapUsd: 1999 },
    })
    // EVID-1: the cap write must also mint the revision snapshot.
    expect(dbMock.policyRevision.create).toHaveBeenCalledTimes(1)
    expect(revalidatedPaths()).toEqual(expect.arrayContaining(["/dashboard", "/dashboard/pools"]))
  })

  it("clears a pool cap when the dollars input is blank", async () => {
    const result = await updatePoolCapAction(
      { ok: false, message: "" },
      form({
        wallet_id: "pool_child",
        pool_id: "pool_child",
        subtree_daily_cap_usd: "",
      }),
    )

    expect(result).toEqual(expect.objectContaining({ ok: true, message: "Pool cap cleared" }))
    expect(dbMock.policy.upsert).toHaveBeenCalledWith({
      where: { walletId: "pool_child" },
      update: { subtreeDailyCapUsd: null, currentRevision: { increment: 1 } },
      create: { walletId: "pool_child", subtreeDailyCapUsd: null },
    })
    expect(dbMock.policyRevision.create).toHaveBeenCalledTimes(1)
    expect(revalidatedPaths()).toEqual(expect.arrayContaining(["/dashboard", "/dashboard/pools"]))
  })

  it("does not update caps outside the logged-in wallet subtree", async () => {
    const result = await updatePoolCapAction(
      { ok: false, message: "" },
      form({
        wallet_id: "pool_foreign",
        pool_id: "pool_foreign",
        subtree_daily_cap_usd: "500",
      }),
    )

    expect(result.ok).toBe(false)
    expect(stateMessage(result)).toMatch(/authorized|not found|subtree/i)
    expect(dbMock.policy.upsert).not.toHaveBeenCalled()
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })
})

describe("applyPoolAllocationAction", () => {
  it("splits a capped parent across direct child pools and writes child caps in one transaction", async () => {
    const result = await applyPoolAllocationAction(
      { ok: false, message: "" },
      form({
        parent_wallet_id: "wallet_root",
        strategy: "delegated",
      }),
    )

    expect(result).toEqual(expect.objectContaining({ ok: true, message: "Allocation applied to 2 child pools." }))
    expect(dbMock.$transaction).toHaveBeenCalledOnce()
    expect(dbMock.policy.upsert).toHaveBeenCalledWith({
      where: { walletId: "pool_child" },
      update: { subtreeDailyCapUsd: 8000, currentRevision: { increment: 1 } },
      create: { walletId: "pool_child", subtreeDailyCapUsd: 8000 },
    })
    expect(dbMock.policy.upsert).toHaveBeenCalledWith({
      where: { walletId: "pool_support" },
      update: { subtreeDailyCapUsd: 2000, currentRevision: { increment: 1 } },
      create: { walletId: "pool_support", subtreeDailyCapUsd: 2000 },
    })
    expect(dbMock.policy.upsert).not.toHaveBeenCalledWith(expect.objectContaining({ where: { walletId: "pool_grandchild" } }))
    // EVID-1: one revision snapshot per allocated child.
    expect(dbMock.policyRevision.create).toHaveBeenCalledTimes(2)
    expect(revalidatedPaths()).toEqual(expect.arrayContaining(["/dashboard", "/dashboard/pools"]))
  })

  it("refuses allocation outside the logged-in wallet subtree", async () => {
    const result = await applyPoolAllocationAction(
      { ok: false, message: "" },
      form({
        parent_wallet_id: "wallet_foreign",
        strategy: "equal",
      }),
    )

    expect(result.ok).toBe(false)
    expect(stateMessage(result)).toMatch(/authorized/i)
    expect(dbMock.policy.upsert).not.toHaveBeenCalled()
    expect(dbMock.$transaction).not.toHaveBeenCalled()
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })

  it("requires the selected parent pool to have its own cap", async () => {
    const result = await applyPoolAllocationAction(
      { ok: false, message: "" },
      form({
        parent_wallet_id: "pool_child",
        strategy: "equal",
      }),
    )

    expect(result.ok).toBe(false)
    expect(stateMessage(result)).toMatch(/parent cap/i)
    expect(dbMock.policy.upsert).not.toHaveBeenCalled()
    expect(dbMock.$transaction).not.toHaveBeenCalled()
  })
})

describe("moveAgentToPoolAction", () => {
  it("moves an in-subtree agent to an in-subtree pool and aligns its clearance wallet", async () => {
    const result = await moveAgentToPoolAction(
      { ok: false, message: "" },
      form({
        agent_id: "agent_child",
        target_wallet_id: "pool_grandchild",
        wallet_id: "pool_grandchild",
        pool_id: "pool_grandchild",
      }),
    )

    expect(result).toEqual(expect.objectContaining({ ok: true, message: "Agent moved" }))
    expect(dbMock.agent.update).toHaveBeenCalledWith({
      where: { id: "agent_child" },
      data: { walletId: "pool_grandchild" },
    })

    const clearanceUpdate = dbMock.agentClearance.update.mock.calls.at(-1)?.[0]
    const clearanceUpdateMany = dbMock.agentClearance.updateMany.mock.calls.at(-1)?.[0]
    expect(clearanceUpdate?.data?.walletId ?? clearanceUpdateMany?.data?.walletId).toBe("pool_grandchild")
    expect(revalidatedPaths()).toEqual(
      expect.arrayContaining(["/dashboard", "/dashboard/agents", "/dashboard/pools"]),
    )
  })

  it("refuses to move an agent from outside the logged-in wallet subtree", async () => {
    const result = await moveAgentToPoolAction(
      { ok: false, message: "" },
      form({
        agent_id: "agent_foreign",
        target_wallet_id: "pool_child",
        wallet_id: "pool_child",
        pool_id: "pool_child",
      }),
    )

    expect(result.ok).toBe(false)
    expect(stateMessage(result)).toMatch(/authorized|not found|subtree/i)
    expect(dbMock.agent.update).not.toHaveBeenCalled()
    expect(dbMock.agentClearance.update).not.toHaveBeenCalled()
    expect(dbMock.agentClearance.updateMany).not.toHaveBeenCalled()
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })

  it("refuses to move an in-subtree agent into a foreign pool", async () => {
    const result = await moveAgentToPoolAction(
      { ok: false, message: "" },
      form({
        agent_id: "agent_child",
        target_wallet_id: "pool_foreign",
        wallet_id: "pool_foreign",
        pool_id: "pool_foreign",
      }),
    )

    expect(result.ok).toBe(false)
    expect(stateMessage(result)).toMatch(/authorized|not found|subtree/i)
    expect(dbMock.agent.update).not.toHaveBeenCalled()
    expect(dbMock.agentClearance.update).not.toHaveBeenCalled()
    expect(dbMock.agentClearance.updateMany).not.toHaveBeenCalled()
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })
})
