import { nanoid } from "nanoid"
import { Prisma } from "./generated/prisma/client"
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
    // Pooled token cap rides the same walk (gateway pre-call wall).
    subtreeDailyTokenCapUsd?: number | null
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

// What the reconcile sums as a subtree's spend for the day (alias ar):
//   - dated by decidedAt, so a grant redemption lands on the day it spends;
//   - observed rows (OBS-1) are would-be spend and never count against an
//     enforcing cap, only toward an observing caller's own would_be;
//   - an approval whose grant is unconsumed (or expired/revoked unused) has
//     spent nothing: redemption reserves it then, exactly once.
function approvedSpendFilter(periodStart: Date, countObserved: boolean): Prisma.Sql {
  return Prisma.sql`ar."status" = 'approved'
    AND COALESCE(ar."decidedAt", ar."createdAt") >= ${periodStart}
    AND (${countObserved}::boolean OR (ar."detailsJson"->>'observed') IS DISTINCT FROM 'true')
    AND NOT EXISTS (
      SELECT 1 FROM "Grant" g
      WHERE g."sourceType" = 'authorization_request'
        AND g."sourceId" = ar."id"
        AND g."status" <> 'consumed'
    )`
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
        policy: { select: { perTransactionMaxUsd: true, subtreeDailyCapUsd: true, subtreeDailyTokenCapUsd: true } },
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
  // A grant redemption reserves its own approved row: leave it out of the
  // reconcile sum, or the seed/reconcile counts it and the increment adds it again.
  redeemingRequestId?: string,
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
        WHERE ${approvedSpendFilter(periodStart, false)}
          AND ar."id" <> ${redeemingRequestId ?? ""}
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
        WHERE ${approvedSpendFilter(periodStart, false)}
          AND ar."id" <> ${redeemingRequestId ?? ""}
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
  // Observe mode's read-only would_be counts observed spend too (OBS-1).
  countObserved = false,
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
        WHERE ${approvedSpendFilter(periodStart, countObserved)}
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

// Approved spend since `since`, as the one where clause every budget read shares.
//   - Dated by decidedAt: a grant redemption counts on the day it spends, not
//     the day it escalated (createdAt covers undated legacy rows).
//   - Observed rows are would-be spend: they count only toward an observing
//     policy's own truthful would_be, never against an enforcing budget (OBS-1).
export function approvedSpendSince(
  agentIds: string | string[],
  since: Date,
  countObserved = false,
): Prisma.AuthorizationRequestWhereInput {
  return {
    agentId: typeof agentIds === "string" ? agentIds : { in: agentIds },
    status: "approved",
    AND: [
      { OR: [{ decidedAt: { gte: since } }, { decidedAt: null, createdAt: { gte: since } }] },
      // A bare NOT on a JSON path drops rows where the path is absent (SQL
      // NULL), i.e. every unmarked row — so match "absent" explicitly.
      ...(countObserved
        ? []
        : [{ OR: [{ detailsJson: { path: ["observed"], equals: Prisma.DbNull } }, { NOT: { detailsJson: { path: ["observed"], equals: true } } }] }]),
    ],
  }
}
