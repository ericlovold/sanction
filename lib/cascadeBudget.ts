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
    // Per-agent model defaults ride it too, so a group with no policy of its
    // own can take them from the nearest wallet above (inheritedTokenDefaults).
    dailyTokenBudgetUsd?: number | null
    monthlyTokenBudgetUsd?: number | null
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

// What the reconcile sums as node `nodeId`'s subtree spend for the day
// (aliases ar, a):
//   - dated by decidedAt, so a grant redemption lands on the day it spends;
//   - observed rows (OBS-1): observe relaxes only the agent's own wallet, so at
//     that wallet's own cap they are would-be spend (counted only toward an
//     observing caller's would_be), while at every ancestor they are real
//     spend — the request proceeded, whatever its would_be status;
//   - an approval whose grant is unconsumed (or expired/revoked unused) has
//     spent nothing: redemption reserves it then, exactly once.
function approvedSpendFilter(periodStart: Date, countObserved: boolean, nodeId: string): Prisma.Sql {
  return Prisma.sql`(
      (ar."status" = 'approved'
        AND (${countObserved}::boolean OR (ar."detailsJson"->>'observed') IS DISTINCT FROM 'true'))
      OR ((ar."detailsJson"->>'observed') = 'true' AND a."walletId" <> ${nodeId})
    )
    AND COALESCE(ar."decidedAt", ar."createdAt") >= ${periodStart}
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
        policy: {
          select: {
            perTransactionMaxUsd: true, subtreeDailyCapUsd: true, subtreeDailyTokenCapUsd: true,
            dailyTokenBudgetUsd: true, monthlyTokenBudgetUsd: true,
          },
        },
      },
    })
    if (!wallet) break
    chain.push(wallet)
    cur = wallet.parentId
  }

  return chain
}

export type TokenDefaults = { dailyTokenBudgetUsd: number; monthlyTokenBudgetUsd?: number | null }

/**
 * The per-agent model limits an agent falls back to when it sets none of its
 * own: its wallet's policy, or, when that wallet has no policy, the policy of
 * the nearest wallet above it. Cents; null when no wallet in the chain has one.
 *
 * This is a fallback, not an overlay. A group with its own policy keeps its
 * own limits, lower or higher than the parent's; only a group with no policy
 * at all inherits. Before this, such a group had no per-agent model limit.
 * `chain` is leaf-first, as walletAncestorChain returns it.
 */
export function inheritedTokenDefaults(chain: WalletBudgetNode[]): TokenDefaults | null {
  const policy = chain.find((node) => node.policy != null)?.policy
  if (policy?.dailyTokenBudgetUsd == null) return null
  return { dailyTokenBudgetUsd: policy.dailyTokenBudgetUsd, monthlyTokenBudgetUsd: policy.monthlyTokenBudgetUsd ?? null }
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
        WHERE ${approvedSpendFilter(periodStart, false, node.id)}
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
        WHERE ${approvedSpendFilter(periodStart, false, node.id)}
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
        WHERE ${approvedSpendFilter(periodStart, countObserved, node.id)}
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

// Approved spend since `since` for the single-window reader.
//   - Dated by decidedAt: a grant redemption counts on the day it spends, not
//     the day it escalated (createdAt covers undated legacy rows).
//   - Observed rows are would-be spend: they count only toward an observing
//     policy's own truthful would_be, never against an enforcing budget (OBS-1).
//   - `unredeemed` are approved rows whose grant is unconsumed (or expired or
//     revoked unused): nothing spent yet, the same exclusion as the reconcile.
export function approvedSpendSince(
  agentIds: string | string[],
  since: Date,
  countObserved = false,
  unredeemed: string[] = [],
): Prisma.AuthorizationRequestWhereInput {
  return {
    agentId: typeof agentIds === "string" ? agentIds : { in: agentIds },
    status: "approved",
    ...(unredeemed.length > 0 ? { id: { notIn: unredeemed } } : {}),
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

export type SpendReadTx = Pick<typeof db, "authorizationRequest" | "grant">

function grantLookbackStart(since: Date): Date {
  return new Date(since.getTime() - 60 * 60 * 1000)
}

// Approved spend since `since` (approvedSpendSince), summed. A grant is minted
// in the approval that stamps its row's decidedAt, so only grants from the
// window (plus slack for app/DB clock skew) can shadow a counted row.
export async function approvedSpendSum(
  tx: SpendReadTx,
  agentIds: string | string[],
  since: Date,
  countObserved = false,
) {
  const grants = await tx.grant.findMany({
    where: {
      agentId: typeof agentIds === "string" ? agentIds : { in: agentIds },
      sourceType: "authorization_request",
      status: { not: "consumed" },
      createdAt: { gte: grantLookbackStart(since) },
    },
    select: { sourceId: true },
  })
  const unredeemed = grants.flatMap((g) => (g.sourceId ? [g.sourceId] : []))
  return tx.authorizationRequest.aggregate({
    where: approvedSpendSince(agentIds, since, countObserved, unredeemed),
    _sum: { amountUsd: true },
  })
}

/** Both agent budget windows in one read under the spend authorization lock. */
export async function agentSpendTotals(
  tx: Pick<typeof db, "$queryRaw">,
  agentId: string,
  dayStart: Date,
  monthStart: Date,
  countObserved: boolean,
) {
  const firstStart = monthStart < dayStart ? monthStart : dayStart
  // A grant can shadow a row in the monthly window but predate the daily
  // lookback. The latest unconsumed grant determines exclusion in each sum.
  const [totals] = await tx.$queryRaw<Array<{ dailySpentUsd: number; monthlySpentUsd: number }>>`
    WITH unredeemed AS (
      SELECT "sourceId", MAX("createdAt") AS issued
      FROM "Grant"
      WHERE "agentId" = ${agentId} AND "sourceType" = 'authorization_request'
        AND "status" <> 'consumed' AND "sourceId" <> ''
        AND "createdAt" >= ${grantLookbackStart(firstStart)}
      GROUP BY "sourceId"
    ), spend AS (
      SELECT ar."amountUsd", COALESCE(ar."decidedAt", ar."createdAt") AS spent, g.issued
      FROM "AuthorizationRequest" ar
      LEFT JOIN unredeemed g ON g."sourceId" = ar.id
      WHERE ar."agentId" = ${agentId} AND ar.status = 'approved'
        AND (ar."decidedAt" >= ${firstStart} OR (ar."decidedAt" IS NULL AND ar."createdAt" >= ${firstStart}))
        AND (${countObserved} OR (ar."detailsJson"->'observed') IS DISTINCT FROM 'true'::jsonb)
    )
    SELECT COALESCE(SUM("amountUsd") FILTER (
             WHERE spent >= ${dayStart} AND (issued IS NULL OR issued < ${grantLookbackStart(dayStart)})
           ), 0) AS "dailySpentUsd",
           COALESCE(SUM("amountUsd") FILTER (
             WHERE spent >= ${monthStart} AND (issued IS NULL OR issued < ${grantLookbackStart(monthStart)})
           ), 0) AS "monthlySpentUsd"
    FROM spend
  `
  return totals
}
