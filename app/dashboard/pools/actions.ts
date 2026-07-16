"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { generateManagementKey } from "@/lib/apiKey"
import { allocatePoolCaps, parseAllocationStrategy, type AllocationChildInput } from "@/lib/budgetAllocation"
import { parseOwnerEmail, parsePoolCapDollars, parsePoolName } from "@/lib/poolForms"
import { agentIsInWalletSet, walletSubtreeIds } from "@/lib/poolAccess"
import { upsertPolicyWithRevision } from "@/lib/policy"
import { requireSessionRole } from "@/lib/session"

export type CreatePoolState = {
  ok: boolean
  message: string
  managementKey?: string
  poolName?: string
}

export type PoolActionState = { ok: boolean; message: string }

function revalidatePools() {
  revalidatePath("/dashboard/pools")
  revalidatePath("/dashboard")
  revalidatePath("/dashboard/spend")
  revalidatePath("/dashboard/agents")
  revalidatePath("/dashboard/keys")
}

function p2002(e: unknown) {
  return typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "P2002"
}

export async function createDelegatedPoolAction(
  _prev: CreatePoolState,
  form: FormData,
): Promise<CreatePoolState> {
  const wallet = await requireSessionRole("admin")
  if (!wallet) return { ok: false, message: "Log in to create pools." }

  const name = parsePoolName(form.get("name"))
  if (!name.ok) return { ok: false, message: name.error }
  const ownerEmail = parseOwnerEmail(form.get("owner_email"))
  if (!ownerEmail.ok) return { ok: false, message: ownerEmail.error }
  const cap = parsePoolCapDollars(form.get("subtree_daily_cap_usd"))
  if (!cap.ok) return { ok: false, message: cap.error }

  const mgmt = generateManagementKey()

  try {
    await db.wallet.create({
      data: {
        name: name.name,
        ownerEmail: ownerEmail.email,
        parentId: wallet.id,
        mgmtKeyHash: mgmt.hash,
        mgmtKeyPrefix: mgmt.prefix,
        policy: {
          create: {
            subtreeDailyCapUsd: cap.cents,
          },
        },
      },
    })
  } catch (e: unknown) {
    if (p2002(e)) return { ok: false, message: "A wallet already exists for this owner email." }
    throw e
  }

  revalidatePools()
  return {
    ok: true,
    message: "Pool created",
    managementKey: mgmt.raw,
    poolName: name.name,
  }
}

export async function updatePoolCapAction(
  _prev: PoolActionState,
  form: FormData,
): Promise<PoolActionState> {
  const wallet = await requireSessionRole("admin")
  if (!wallet) return { ok: false, message: "Log in to update pools." }

  const walletId = String(form.get("wallet_id") ?? "")
  if (!walletId) return { ok: false, message: "Choose a pool." }
  const cap = parsePoolCapDollars(form.get("subtree_daily_cap_usd"))
  if (!cap.ok) return { ok: false, message: cap.error }

  const allowedWalletIds = await walletSubtreeIds(db, wallet.id)
  if (!allowedWalletIds.includes(walletId)) return { ok: false, message: "Not authorized for that pool." }

  await db.$transaction((tx) => upsertPolicyWithRevision(tx, walletId, { subtreeDailyCapUsd: cap.cents }))

  revalidatePools()
  return { ok: true, message: cap.cents === null ? "Pool cap cleared" : "Pool cap saved" }
}

async function childAllocationInputs(parentWalletId: string): Promise<{ parentCapCents: number | null; children: AllocationChildInput[] }> {
  const parent = await db.wallet.findUnique({
    where: { id: parentWalletId },
    select: { policy: { select: { subtreeDailyCapUsd: true } } },
  })
  const directChildren = await db.wallet.findMany({
    where: { parentId: { in: [parentWalletId] } },
    select: { id: true, name: true },
  })
  if (directChildren.length === 0) return { parentCapCents: parent?.policy?.subtreeDailyCapUsd ?? null, children: [] }

  const walletToChild = new Map<string, string>()
  const descendantIds = new Set<string>()
  for (const child of directChildren) {
    const ids = await walletSubtreeIds(db, child.id)
    for (const id of ids) {
      descendantIds.add(id)
      walletToChild.set(id, child.id)
    }
  }

  const wallets = await db.wallet.findMany({
    where: { id: { in: Array.from(descendantIds) } },
    select: { id: true, policy: { select: { dailySpendBudgetUsd: true } } },
  })
  const walletPolicy = new Map(wallets.map((wallet) => [wallet.id, wallet.policy?.dailySpendBudgetUsd ?? 0]))
  const agents = await db.agent.findMany({
    where: { walletId: { in: Array.from(descendantIds) } },
    select: { id: true, walletId: true, isActive: true, dailySpendBudgetUsd: true },
  })
  const agentToChild = new Map<string, string>()
  const delegatedByChild = new Map(directChildren.map((child) => [child.id, 0]))
  for (const agent of agents) {
    const childId = walletToChild.get(agent.walletId)
    if (!childId) continue
    agentToChild.set(agent.id, childId)
    if (!agent.isActive) continue
    delegatedByChild.set(
      childId,
      (delegatedByChild.get(childId) ?? 0) + (agent.dailySpendBudgetUsd ?? walletPolicy.get(agent.walletId) ?? 0),
    )
  }

  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)
  const spendToday = await db.authorizationRequest.groupBy({
    by: ["agentId"],
    where: { agentId: { in: agents.map((agent) => agent.id) }, status: "approved", createdAt: { gte: dayStart } },
    _sum: { amountUsd: true },
  })
  const spendByChild = new Map(directChildren.map((child) => [child.id, 0]))
  for (const row of spendToday) {
    const childId = agentToChild.get(row.agentId)
    if (!childId) continue
    spendByChild.set(childId, (spendByChild.get(childId) ?? 0) + Math.round((row._sum.amountUsd ?? 0) * 100))
  }

  return {
    parentCapCents: parent?.policy?.subtreeDailyCapUsd ?? null,
    children: directChildren.map((child) => ({
      id: child.id,
      name: child.name,
      delegatedDailyCents: delegatedByChild.get(child.id) ?? 0,
      spendTodayCents: spendByChild.get(child.id) ?? 0,
    })),
  }
}

export async function applyPoolAllocationAction(
  _prev: PoolActionState,
  form: FormData,
): Promise<PoolActionState> {
  const wallet = await requireSessionRole("admin")
  if (!wallet) return { ok: false, message: "Log in to allocate pools." }

  const parentWalletId = String(form.get("parent_wallet_id") ?? "")
  if (!parentWalletId) return { ok: false, message: "Choose a parent pool." }
  const strategy = parseAllocationStrategy(form.get("strategy"))

  const allowedWalletIds = await walletSubtreeIds(db, wallet.id)
  if (!allowedWalletIds.includes(parentWalletId)) return { ok: false, message: "Not authorized for that pool." }

  const { parentCapCents, children } = await childAllocationInputs(parentWalletId)
  if (parentCapCents === null) return { ok: false, message: "Set a parent cap before allocating child pools." }
  if (children.length === 0) return { ok: false, message: "That pool has no child pools to allocate." }

  const allocation = allocatePoolCaps(parentCapCents, children, strategy)
  await db.$transaction(async (tx) => {
    for (const row of allocation) {
      await upsertPolicyWithRevision(tx, row.id, { subtreeDailyCapUsd: row.capCents })
    }
  })

  revalidatePools()
  return { ok: true, message: `Allocation applied to ${allocation.length} child pools.` }
}

export async function moveAgentToPoolAction(
  _prev: PoolActionState,
  form: FormData,
): Promise<PoolActionState> {
  const wallet = await requireSessionRole("admin")
  if (!wallet) return { ok: false, message: "Log in to move agents." }

  const agentId = String(form.get("agent_id") ?? "")
  const targetWalletId = String(form.get("target_wallet_id") ?? "")
  if (!agentId || !targetWalletId) return { ok: false, message: "Choose an agent and pool." }

  const allowedWalletIds = await walletSubtreeIds(db, wallet.id)
  if (!allowedWalletIds.includes(targetWalletId)) return { ok: false, message: "Not authorized for that pool." }

  const agent = await agentIsInWalletSet(db, agentId, allowedWalletIds)
  if (!agent) return { ok: false, message: "Not authorized for that agent." }
  if (agent.walletId === targetWalletId) return { ok: true, message: "Agent already belongs to that pool." }

  await db.$transaction(async (tx) => {
    await tx.agent.update({
      where: { id: agentId },
      data: { walletId: targetWalletId },
    })
    await tx.agentClearance.updateMany({
      where: { agentId },
      data: { walletId: targetWalletId },
    })
  })

  revalidatePools()
  return { ok: true, message: "Agent moved" }
}
