import { nanoid } from "nanoid"
import { db } from "./db"

export type CascadeTx = Pick<typeof db, "wallet" | "$executeRaw" | "$queryRaw">

export type WalletBudgetNode = {
  id: string
  parentId: string | null
  policy: {
    dailySpendBudgetUsd: number
    perTransactionMaxUsd: number
  } | null
}

const MAX_ANCESTOR_DEPTH = 16
const PERIOD_DAILY = "daily"

export class CascadeBudgetExceeded extends Error {
  walletId: string
  capCents: number
  periodStart: Date

  constructor(walletId: string, capCents: number, periodStart: Date) {
    super("Wallet daily spend budget exceeded")
    this.name = "CascadeBudgetExceeded"
    this.walletId = walletId
    this.capCents = capCents
    this.periodStart = periodStart
  }
}

export function dayStart(d = new Date()): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

export async function walletAncestorChain(tx: CascadeTx, walletId: string): Promise<WalletBudgetNode[]> {
  const chain: WalletBudgetNode[] = []
  const seen = new Set<string>()
  let cur: string | null = walletId

  for (let depth = 0; cur && depth < MAX_ANCESTOR_DEPTH; depth++) {
    if (seen.has(cur)) break
    seen.add(cur)
    const wallet = await tx.wallet.findUnique({
      where: { id: cur },
      select: {
        id: true,
        parentId: true,
        policy: { select: { dailySpendBudgetUsd: true, perTransactionMaxUsd: true } },
      },
    })
    if (!wallet) break
    chain.push(wallet)
    cur = wallet.parentId
  }

  return chain
}

export function effectivePerTransactionMaxCents(
  agentOverrideCents: number | null,
  ownPolicyCents: number,
  chain: WalletBudgetNode[],
): number {
  const caps = [agentOverrideCents ?? ownPolicyCents]
  for (const node of chain.slice(1)) {
    if (node.policy) caps.push(node.policy.perTransactionMaxUsd)
  }
  return Math.min(...caps)
}

export async function reserveCascadeDailySpend(
  tx: CascadeTx,
  walletId: string,
  amountCents: number,
  now = new Date(),
  chain?: WalletBudgetNode[],
): Promise<void> {
  const nodes = chain ?? (await walletAncestorChain(tx, walletId))
  const periodStart = dayStart(now)

  // Update ancestors in a stable root→leaf order so sibling agents do not deadlock
  // when they share an ancestor. Any failed conditional update throws, causing the
  // surrounding transaction to roll back every earlier counter increment.
  for (const node of [...nodes].reverse()) {
    const capCents = node.policy?.dailySpendBudgetUsd
    if (capCents == null) continue

    await tx.$executeRaw`
      INSERT INTO "WalletBudgetCounter" ("id", "walletId", "period", "periodStart", "spentCents", "updatedAt")
      VALUES (${nanoid()}, ${node.id}, ${PERIOD_DAILY}, ${periodStart}, 0, ${now})
      ON CONFLICT ("walletId", "period", "periodStart") DO NOTHING
    `

    const changed = await tx.$executeRaw`
      UPDATE "WalletBudgetCounter"
      SET "spentCents" = "spentCents" + ${amountCents}, "updatedAt" = ${now}
      WHERE "walletId" = ${node.id}
        AND "period" = ${PERIOD_DAILY}
        AND "periodStart" = ${periodStart}
        AND "spentCents" + ${amountCents} <= ${capCents}
    `
    if (changed !== 1) throw new CascadeBudgetExceeded(node.id, capCents, periodStart)
  }
}

export async function cascadeDailyWouldExceed(
  tx: CascadeTx,
  walletId: string,
  amountCents: number,
  now = new Date(),
  chain?: WalletBudgetNode[],
): Promise<boolean> {
  const nodes = chain ?? (await walletAncestorChain(tx, walletId))
  const periodStart = dayStart(now)

  for (const node of nodes) {
    const capCents = node.policy?.dailySpendBudgetUsd
    if (capCents == null) continue
    const rows = await tx.$queryRaw<Array<{ one: number }>>`
      SELECT 1 AS one FROM "WalletBudgetCounter"
      WHERE "walletId" = ${node.id}
        AND "period" = ${PERIOD_DAILY}
        AND "periodStart" = ${periodStart}
        AND "spentCents" + ${amountCents} > ${capCents}
      LIMIT 1
    `
    if (rows.length > 0) return true
  }
  return false
}
