import { nanoid } from "nanoid"
import { db } from "./db"
import { crossedThreshold } from "./burn"

export type CascadeTx = Pick<typeof db, "wallet" | "$executeRaw" | "$queryRaw">

export type WalletBudgetNode = {
  id: string
  parentId: string | null
  // KILL-1: freeze state rides the ancestor walk so routes that already fetch
  // the chain get the kill-switch check with zero extra queries.
  frozenAt?: Date | null
  frozenReason?: string | null
  policy: {
    perTransactionMaxUsd: number
    subtreeDailyCapUsd: number | null
  } | null
}

const MAX_ANCESTOR_DEPTH = 16
const MAX_SUBTREE_DEPTH = 32
const PERIOD_DAILY = "daily"
export const SUBTREE_CAP_EXCEEDED_NOTE = "Subtree daily spend cap exceeded"

export class CascadeBudgetExceeded extends Error {
  walletId: string
  capCents: number
  periodStart: Date

  constructor(walletId: string, capCents: number, periodStart: Date) {
    super(SUBTREE_CAP_EXCEEDED_NOTE)
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
    const wallet: WalletBudgetNode | null = await tx.wallet.findUnique({
      where: { id: cur },
      select: {
        id: true,
        parentId: true,
        frozenAt: true,
        frozenReason: true,
        policy: { select: { perTransactionMaxUsd: true, subtreeDailyCapUsd: true } },
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

/** A capped ancestor pushed across the alert threshold by this reservation. */
export type CascadeCrossing = { walletId: string; capCents: number; spentCents: number }

export async function reserveCascadeDailySpend(
  tx: CascadeTx,
  walletId: string,
  amountCents: number,
  now = new Date(),
  chain?: WalletBudgetNode[],
): Promise<CascadeCrossing[]> {
  const nodes = chain ?? (await walletAncestorChain(tx, walletId))
  const periodStart = dayStart(now)
  const capped = nodes.filter((node) => node.policy?.subtreeDailyCapUsd != null)
  const crossings: CascadeCrossing[] = []
  if (capped.length === 0) return crossings

  // Update ancestors in a stable root→leaf order so sibling agents do not deadlock
  // when they share an ancestor. Any failed conditional update throws, causing the
  // surrounding transaction to roll back every earlier counter increment.
  for (const node of [...capped].reverse()) {
    const capCents = node.policy?.subtreeDailyCapUsd
    if (capCents == null) continue

    await tx.$executeRaw`
      WITH RECURSIVE subtree(id, path) AS (
        SELECT "id", ARRAY["id"]
        FROM "Wallet"
        WHERE "id" = ${node.id}
        UNION ALL
        SELECT child."id", subtree.path || child."id"
        FROM "Wallet" child
        JOIN subtree ON child."parentId" = subtree.id
        WHERE NOT child."id" = ANY(subtree.path)
          AND cardinality(subtree.path) < ${MAX_SUBTREE_DEPTH}
      ), rolled AS (
        SELECT COALESCE(SUM(ROUND(ar."amountUsd" * 100))::int, 0) AS "spentCents"
        FROM subtree
        JOIN "Agent" a ON a."walletId" = subtree.id
        JOIN "AuthorizationRequest" ar ON ar."agentId" = a.id
        WHERE ar."status" = 'approved'
          AND ar."createdAt" >= ${periodStart}
      )
      INSERT INTO "WalletBudgetCounter" ("id", "walletId", "period", "periodStart", "spentCents", "updatedAt")
      SELECT ${nanoid()}, ${node.id}, ${PERIOD_DAILY}, ${periodStart}, rolled."spentCents", ${now}
      FROM rolled
      ON CONFLICT ("walletId", "period", "periodStart") DO NOTHING
    `

    // Reconcile before incrementing so a cap enabled, disabled, then re-enabled
    // later in the same day cannot undercount spend that happened while disabled.
    await tx.$executeRaw`
      WITH RECURSIVE subtree(id, path) AS (
        SELECT "id", ARRAY["id"]
        FROM "Wallet"
        WHERE "id" = ${node.id}
        UNION ALL
        SELECT child."id", subtree.path || child."id"
        FROM "Wallet" child
        JOIN subtree ON child."parentId" = subtree.id
        WHERE NOT child."id" = ANY(subtree.path)
          AND cardinality(subtree.path) < ${MAX_SUBTREE_DEPTH}
      ), rolled AS (
        SELECT COALESCE(SUM(ROUND(ar."amountUsd" * 100))::int, 0) AS "spentCents"
        FROM subtree
        JOIN "Agent" a ON a."walletId" = subtree.id
        JOIN "AuthorizationRequest" ar ON ar."agentId" = a.id
        WHERE ar."status" = 'approved'
          AND ar."createdAt" >= ${periodStart}
      )
      UPDATE "WalletBudgetCounter"
      SET "spentCents" = GREATEST("spentCents", (SELECT "spentCents" FROM rolled)), "updatedAt" = ${now}
      WHERE "walletId" = ${node.id}
        AND "period" = ${PERIOD_DAILY}
        AND "periodStart" = ${periodStart}
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

    // Threshold-crossing detection for the "no surprises" alert: read the
    // counter this reservation just incremented; if the charge moved it from
    // below the alert line to at-or-above, report it so the caller can notify
    // (after the response, never in-path).
    const counters = await tx.$queryRaw<Array<{ spentCents: number }>>`
      SELECT "spentCents" FROM "WalletBudgetCounter"
      WHERE "walletId" = ${node.id} AND "period" = ${PERIOD_DAILY} AND "periodStart" = ${periodStart}
    `
    const spentAfter = counters[0]?.spentCents
    if (spentAfter != null && crossedThreshold(spentAfter - amountCents, spentAfter, capCents)) {
      crossings.push({ walletId: node.id, capCents, spentCents: spentAfter })
    }
  }
  return crossings
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
    const capCents = node.policy?.subtreeDailyCapUsd
    if (capCents == null) continue
    const rows = await tx.$queryRaw<Array<{ one: number }>>`
      WITH RECURSIVE subtree(id, path) AS (
        SELECT "id", ARRAY["id"]
        FROM "Wallet"
        WHERE "id" = ${node.id}
        UNION ALL
        SELECT child."id", subtree.path || child."id"
        FROM "Wallet" child
        JOIN subtree ON child."parentId" = subtree.id
        WHERE NOT child."id" = ANY(subtree.path)
          AND cardinality(subtree.path) < ${MAX_SUBTREE_DEPTH}
      ), rolled AS (
        SELECT COALESCE(SUM(ROUND(ar."amountUsd" * 100))::int, 0) AS "spentCents"
        FROM subtree
        JOIN "Agent" a ON a."walletId" = subtree.id
        JOIN "AuthorizationRequest" ar ON ar."agentId" = a.id
        WHERE ar."status" = 'approved'
          AND ar."createdAt" >= ${periodStart}
      ), existing AS (
        SELECT "spentCents" FROM "WalletBudgetCounter"
        WHERE "walletId" = ${node.id}
          AND "period" = ${PERIOD_DAILY}
          AND "periodStart" = ${periodStart}
      )
      SELECT CASE
        WHEN GREATEST(COALESCE((SELECT "spentCents" FROM existing), 0), (SELECT "spentCents" FROM rolled)) + ${amountCents} > ${capCents}
        THEN 1 ELSE 0
      END AS one
    `
    if (Number(rows[0]?.one ?? 0) === 1) return true
  }
  return false
}
