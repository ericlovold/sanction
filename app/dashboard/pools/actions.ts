"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { generateManagementKey } from "@/lib/apiKey"
import { parseOwnerEmail, parsePoolCapDollars, parsePoolName } from "@/lib/poolForms"
import { agentIsInWalletSet, walletSubtreeIds } from "@/lib/poolAccess"
import { getSessionWallet } from "@/lib/session"

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
  const wallet = await getSessionWallet()
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
  const wallet = await getSessionWallet()
  if (!wallet) return { ok: false, message: "Log in to update pools." }

  const walletId = String(form.get("wallet_id") ?? "")
  if (!walletId) return { ok: false, message: "Choose a pool." }
  const cap = parsePoolCapDollars(form.get("subtree_daily_cap_usd"))
  if (!cap.ok) return { ok: false, message: cap.error }

  const allowedWalletIds = await walletSubtreeIds(db, wallet.id)
  if (!allowedWalletIds.includes(walletId)) return { ok: false, message: "Not authorized for that pool." }

  await db.policy.upsert({
    where: { walletId },
    update: { subtreeDailyCapUsd: cap.cents },
    create: { walletId, subtreeDailyCapUsd: cap.cents },
  })

  revalidatePools()
  return { ok: true, message: cap.cents === null ? "Pool cap cleared" : "Pool cap saved" }
}

export async function moveAgentToPoolAction(
  _prev: PoolActionState,
  form: FormData,
): Promise<PoolActionState> {
  const wallet = await getSessionWallet()
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
