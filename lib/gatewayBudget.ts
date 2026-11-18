import { db } from "./db"
import { Prisma } from "./generated/prisma/client"
import type { WalletBudgetNode } from "./cascadeBudget"
import { costUsd, type GatewayUsage, type TokenBudgetVerdict } from "./gateway"
import { logger } from "./log"
import { freezeStateFromChain, frozenNote, type FreezeState } from "./freeze"

export type GatewayBudgetAgent = {
  id: string
  walletId: string
  isActive: boolean
  dailyTokenBudgetUsd: number | null
  monthlyTokenBudgetUsd?: number | null
  wallet: { policy: { dailyTokenBudgetUsd: number; monthlyTokenBudgetUsd?: number | null } | null }
}

export type GatewayReservationInput = { provider: string; model: string; reservedUsd: number }
export type GatewayReservationVerdict = TokenBudgetVerdict & { reservationId?: string; decisionId?: string }
export type GatewayBudgetDenialInput = {
  provider: string
  model?: string
  path?: string
  requestedUsd?: number
  verdict: TokenBudgetVerdict
}
export type TokenUsageData = { model: string; tokensIn: number; tokensOut: number; costUsd: number; taskLabel?: string }
type Tx = Prisma.TransactionClient
const log = logger("gateway-budget")
const MICROS_PER_USD = 1_000_000

/** A verified freeze is a policy denial, not an unavailable budget store. */
export class GatewayWalletFrozenError extends Error {
  readonly code = "WALLET_FROZEN"
  constructor(readonly freeze: Extract<FreezeState, { frozen: true }>) {
    super(frozenNote(freeze))
    this.name = "GatewayWalletFrozenError"
  }
}

function assertBudgetUnfrozen(chain: WalletBudgetNode[], walletId: string): void {
  const freeze = freezeStateFromChain(chain, walletId)
  if (!freeze.frozen) return
  if (freeze.unverified) throw new Error("Wallet hierarchy could not be verified")
  throw new GatewayWalletFrozenError(freeze)
}

/** Costs round upward at microdollar precision. Ignore only floating-point
 * dust near an integer (for example 0.1 + 0.1 + 0.1), not real fractions. */
function costMicros(amount: number): number {
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Invalid token cost")
  const scaled = amount * MICROS_PER_USD
  const dust = Math.min(0.0001, Number.EPSILON * Math.max(1, scaled) * 4)
  const micros = Math.max(amount > 0 ? 1 : 0, Math.ceil(scaled - dust))
  if (!Number.isSafeInteger(micros) || scaled > Number.MAX_SAFE_INTEGER) throw new Error("Token cost exceeds safe accounting precision")
  return micros
}

function addMicros(left: number, right: number): number {
  const sum = left + right
  if (!Number.isSafeInteger(sum)) throw new Error("Token cost exceeds safe accounting precision")
  return sum
}

function exceeds(spent: number, amount: number, capCents: number): boolean {
  // Policy caps already are integer cents: converting directly avoids ever
  // rounding a fractional dollar limit upward.
  const capMicros = capCents * 10_000
  if (!Number.isSafeInteger(capCents) || capCents < 0 || !Number.isSafeInteger(capMicros)) throw new Error("Invalid token budget")
  return addMicros(costMicros(spent), costMicros(amount)) > capMicros
}

function periods(now: Date) {
  const day = new Date(now)
  day.setHours(0, 0, 0, 0)
  const month = new Date(day)
  month.setDate(1)
  return { day, month }
}

type AncestorRow = Omit<WalletBudgetNode, "policy"> & {
  policyId: string | null
  perTransactionMaxUsd: number
  subtreeDailyCapUsd: number | null
  subtreeDailyTokenCapUsd: number | null
  policyDaily: number | null; policyMonthly: number | null
  seatId: string | null; seatWalletId: string | null; seatActive: boolean | null; seatExpiresAt: Date | null
  seatDaily: number | null; seatMonthly: number | null
}
type BudgetSnapshot = { chain: WalletBudgetNode[]; current: (GatewayBudgetAgent & { expiresAt: Date | null }) | null }

/** Same leaf-first, cycle-safe 16-node bound as the shared ancestor walker,
 * in one round trip. An incomplete chain is rejected by lockBudget below. */
async function budgetSnapshot(tx: Tx, agent: Pick<GatewayBudgetAgent, "id" | "walletId">): Promise<BudgetSnapshot> {
  const rows = await tx.$queryRaw<AncestorRow[]>`
    WITH RECURSIVE ancestors AS (
      SELECT w."id", w."parentId", w."frozenAt", w."frozenReason", ARRAY[w."id"] AS path
      FROM "Wallet" w WHERE w."id" = ${agent.walletId}
      UNION ALL
      SELECT w."id", w."parentId", w."frozenAt", w."frozenReason", a.path || w."id"
      FROM "Wallet" w JOIN ancestors a ON w."id" = a."parentId"
      WHERE cardinality(a.path) < 16 AND NOT w."id" = ANY(a.path)
    )
    SELECT a."id", a."parentId", a."frozenAt", a."frozenReason",
      p."id" AS "policyId", p."perTransactionMaxUsd", p."subtreeDailyCapUsd", p."subtreeDailyTokenCapUsd",
      p."dailyTokenBudgetUsd" AS "policyDaily", p."monthlyTokenBudgetUsd" AS "policyMonthly",
      seat.id AS "seatId", seat."walletId" AS "seatWalletId", seat."isActive" AS "seatActive",
      seat."expiresAt" AS "seatExpiresAt", seat."dailyTokenBudgetUsd" AS "seatDaily", seat."monthlyTokenBudgetUsd" AS "seatMonthly"
    FROM ancestors a LEFT JOIN "Policy" p ON p."walletId" = a."id"
    LEFT JOIN "Agent" seat ON seat.id = ${agent.id} AND seat."walletId" = ${agent.walletId}
    ORDER BY cardinality(a.path)
  `
  const chain = rows.map((row) => ({
    id: row.id, parentId: row.parentId, frozenAt: row.frozenAt, frozenReason: row.frozenReason,
    policy: row.policyId == null ? null : { perTransactionMaxUsd: row.perTransactionMaxUsd,
      subtreeDailyCapUsd: row.subtreeDailyCapUsd, subtreeDailyTokenCapUsd: row.subtreeDailyTokenCapUsd },
  }))
  const own = rows[0]
  const current = own?.seatId && own.seatWalletId ? {
    id: own.seatId, walletId: own.seatWalletId, isActive: own.seatActive === true, expiresAt: own.seatExpiresAt,
    dailyTokenBudgetUsd: own.seatDaily, monthlyTokenBudgetUsd: own.seatMonthly,
    wallet: { policy: own.policyDaily == null ? null : { dailyTokenBudgetUsd: own.policyDaily, monthlyTokenBudgetUsd: own.policyMonthly } },
  } : null
  return { chain, current }
}

/** Reservations and /tokens take the same wallet locks, then the agent lock.
 * Wallet locks include uncapped ancestors so sibling seats share a lock even
 * when a cap is newly enabled. The transaction ends before any provider IO. */
async function lockBudget(tx: Tx, agent: Pick<GatewayBudgetAgent, "id" | "walletId">): Promise<BudgetSnapshot> {
  const { chain } = await budgetSnapshot(tx, agent)
  if (!chain.length || chain[0].id !== agent.walletId || chain.at(-1)?.parentId !== null) {
    throw new Error("Incomplete wallet ancestry; token budget cannot be enforced")
  }
  const keys = [...chain.map((node) => node.id).sort().map((id) => `token-budget:wallet:${id}`), agent.id]
  // PostgreSQL evaluates output expressions after ORDER BY when they are not
  // used in the sort. Ordinality preserves sorted wallets, then the agent.
  // Do not fold reads into this statement: its snapshot predates any lock wait.
  await tx.$executeRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(hashtext(k.key)::int8)
    FROM unnest(ARRAY[${Prisma.join(keys)}]::text[]) WITH ORDINALITY AS k(key, ord)
    ORDER BY k.ord
  `)
  // Read policy after acquiring locks. Membership changes require a retry so
  // an admission never proceeds while missing one of its current pool locks.
  const snapshot = await budgetSnapshot(tx, agent)
  const lockedChain = snapshot.chain
  if (lockedChain.map((node) => node.id).join("/") !== chain.map((node) => node.id).join("/") || lockedChain.at(-1)?.parentId !== null) {
    throw new Error("Wallet ancestry changed during token budget admission")
  }
  return snapshot
}

function currentAgent(current: BudgetSnapshot["current"]): GatewayBudgetAgent {
  if (!current || !current.isActive || current.expiresAt && current.expiresAt <= new Date()) {
    throw new Error("Agent is no longer authorized to consume token budget")
  }
  return current
}

type OccupancyRow = {
  scopeId: string; kind: "agent" | "pool"; walletIds: string[]; incomplete: boolean
  dailyLogs: number; monthlyLogs: number; holds: number[]
}

/** One statement for all horizons/scopes. Each pool's traversal stops at 500
 * nodes, then verifies completeness. Logs and holds never join each other,
 * preventing duplicated usage. Holds retain their individual micro rounding. */
async function budgetOccupancy(tx: Tx, agentId: string, poolIds: string[], now: Date, monthly: boolean): Promise<OccupancyRow[]> {
  const { day, month } = periods(now)
  const poolArray = poolIds.length ? Prisma.sql`ARRAY[${Prisma.join(poolIds)}]::text[]` : Prisma.sql`ARRAY[]::text[]`
  return tx.$queryRaw<OccupancyRow[]>(Prisma.sql`
    WITH scopes AS (
      SELECT ${agentId}::text AS "scopeId", 'agent'::text AS kind, ARRAY[]::text[] AS "walletIds"
      UNION ALL
      SELECT root.id, 'pool', members.ids
      FROM unnest(${poolArray}) AS root(id)
      CROSS JOIN LATERAL (
        WITH RECURSIVE subtree AS (
          SELECT w."id", ARRAY[w."id"] AS path FROM "Wallet" w WHERE w."id" = root.id
          UNION ALL
          SELECT w."id", s.path || w."id" FROM "Wallet" w JOIN subtree s ON w."parentId" = s."id"
          WHERE cardinality(s.path) <= 32 AND NOT w."id" = ANY(s.path)
        )
        SELECT COALESCE(array_agg(bounded."id"), ARRAY[]::text[]) AS ids
        FROM (SELECT "id" FROM subtree LIMIT 500) bounded
      ) members
    )
    SELECT s."scopeId", s.kind, s."walletIds",
      (s.kind = 'pool' AND EXISTS (
        SELECT 1 FROM "Wallet" child WHERE child."parentId" = ANY(s."walletIds") AND NOT child."id" = ANY(s."walletIds")
      )) AS incomplete,
      COALESCE(logs.daily, 0)::float8 AS "dailyLogs", COALESCE(logs.monthly, 0)::float8 AS "monthlyLogs",
      ARRAY(
        SELECT GREATEST(r."reservedUsd", r."observedUsd") FROM "GatewayReservation" r
        WHERE r.status IN ('pending', 'uncertain') AND (
          (s.kind = 'agent' AND r."agentId" = s."scopeId") OR (s.kind = 'pool' AND r."walletId" = ANY(s."walletIds"))
        )
      ) AS holds
    FROM scopes s
    LEFT JOIN LATERAL (
      SELECT SUM(l."costUsd") FILTER (WHERE l."createdAt" >= ${day}) AS daily, SUM(l."costUsd") AS monthly
      FROM "TokenLog" l
      LEFT JOIN "GatewayReservation" r ON r.id = l."gatewayReservationId"
      LEFT JOIN "Agent" a ON a.id = l."agentId"
      WHERE l."createdAt" >= CASE WHEN s.kind = 'agent' AND ${monthly}::boolean THEN ${month}::timestamp ELSE ${day}::timestamp END AND (
        (s.kind = 'agent' AND l."agentId" = s."scopeId" AND (l."gatewayReservationId" IS NULL OR r.status = 'settled'))
        OR (s.kind = 'pool' AND (
          (l."gatewayReservationId" IS NULL AND a."walletId" = ANY(s."walletIds"))
          OR (r.status = 'settled' AND r."walletId" = ANY(s."walletIds"))
        ))
      )
    ) logs ON true
  `)
}

function occupiedUsd(row: OccupancyRow, monthly = false): number {
  const heldMicros = row.holds.reduce((sum, hold) => addMicros(sum, costMicros(hold)), 0)
  return addMicros(costMicros(monthly ? row.monthlyLogs : row.dailyLogs), heldMicros) / MICROS_PER_USD
}

async function checkBudget(tx: Tx, agent: GatewayBudgetAgent, amount: number, chain: WalletBudgetNode[], now: Date): Promise<TokenBudgetVerdict> {
  const monthlyCents = agent.monthlyTokenBudgetUsd ?? agent.wallet.policy?.monthlyTokenBudgetUsd
  const rows = await budgetOccupancy(tx, agent.id, chain.filter((node) => node.policy?.subtreeDailyTokenCapUsd != null).map((node) => node.id), now, monthlyCents != null)
  const own = rows.find((row) => row.kind === "agent" && row.scopeId === agent.id)
  if (!own) throw new Error("Incomplete agent token budget snapshot")
  const dailyCents = agent.dailyTokenBudgetUsd ?? agent.wallet.policy?.dailyTokenBudgetUsd
  const daily = dailyCents == null ? null : dailyCents / 100
  const spent = occupiedUsd(own)
  if (dailyCents != null && exceeds(spent, amount, dailyCents)) return { exhausted: true, spent, budget: daily, horizon: "daily" }

  if (monthlyCents != null) {
    const monthSpent = occupiedUsd(own, true)
    if (exceeds(monthSpent, amount, monthlyCents)) return { exhausted: true, spent: monthSpent, budget: monthlyCents / 100, horizon: "monthly" }
  }
  for (const node of chain) {
    const capCents = node.policy?.subtreeDailyTokenCapUsd
    if (capCents == null) continue
    const pool = rows.find((row) => row.kind === "pool" && row.scopeId === node.id)
    // poolAccess bounds dashboard traversals; a truncated membership list is
    // not sufficient evidence to admit more spend.
    if (pool && pool.walletIds.length >= 500) throw new Error("Token pool membership exceeds the enforcement traversal limit")
    if (!pool || !pool.walletIds.includes(agent.walletId) || pool.incomplete) throw new Error("Incomplete token pool membership; budget cannot be enforced")
    const poolSpent = occupiedUsd(pool)
    if (exceeds(poolSpent, amount, capCents)) {
      return { exhausted: true, spent: poolSpent, budget: capCents / 100, horizon: "subtree-daily", capWalletId: node.id }
    }
  }
  return { exhausted: false, spent, budget: daily }
}

/** Reuse the canonical decision stream without claiming pure-engine replay
 * evidence. A refusal is terminal and carries no spend or execution authority. */
export async function recordGatewayBudgetDenial(
  agent: Pick<GatewayBudgetAgent, "id" | "walletId">,
  input: GatewayBudgetDenialInput,
  tx: Pick<Prisma.TransactionClient, "authorizationRequest"> = db,
): Promise<string> {
  const { verdict } = input
  if (!verdict.exhausted || verdict.budget == null) throw new Error("Gateway denial receipt requires an exhausted budget")
  costMicros(verdict.budget)
  costMicros(verdict.spent)
  if (input.requestedUsd != null) costMicros(input.requestedUsd)
  const model = input.model ?? "not-applicable"
  const horizon = verdict.horizon ?? "daily"
  const now = new Date()
  // Signed exports carry the note, but not detailsJson. Keep the decision's
  // provider, model, horizon and numbers in both representations.
  const reason = `Gateway token budget exceeded: ${horizon}; provider=${input.provider}; model=${model}; limit_usd=${verdict.budget}; occupied_usd=${verdict.spent}; requested_reservation_usd=${input.requestedUsd ?? "not-applicable"}`
  const receipt = await tx.authorizationRequest.create({
    data: {
      agentId: agent.id,
      kind: "tool",
      action: "invoke",
      amountUsd: 0,
      merchant: `gateway:${input.provider}:${model}`,
      category: "gateway",
      status: "denied",
      decisionNote: reason,
      createdAt: now,
      decidedAt: now,
      detailsJson: {
        source: "gateway",
        code: "GATEWAY_BUDGET_EXCEEDED",
        wallet_id: agent.walletId,
        provider: input.provider,
        model,
        path: input.path ?? null,
        horizon,
        limit_usd: verdict.budget,
        occupied_usd: verdict.spent,
        requested_reservation_usd: input.requestedUsd ?? null,
        cap_wallet_id: verdict.capWalletId ?? null,
      },
    },
    select: { id: true },
  })
  return receipt.id
}

/** The returned ID exists durably before the caller may contact the provider. */
export async function reserveGatewayBudget(agent: GatewayBudgetAgent, input: GatewayReservationInput): Promise<GatewayReservationVerdict> {
  const reservedUsd = costMicros(input.reservedUsd) / MICROS_PER_USD
  return db.$transaction(async (tx) => {
    const snapshot = await lockBudget(tx, agent)
    const chain = snapshot.chain
    const current = currentAgent(snapshot.current)
    assertBudgetUnfrozen(chain, agent.walletId)
    const now = new Date()
    const verdict = await checkBudget(tx, current, reservedUsd, chain, now)
    if (verdict.exhausted) {
      const decisionId = await recordGatewayBudgetDenial(current, {
        provider: input.provider, model: input.model, requestedUsd: reservedUsd, verdict,
      }, tx)
      return { ...verdict, decisionId }
    }
    const reservation = await tx.gatewayReservation.create({
      data: {
        agentId: agent.id,
        walletId: agent.walletId,
        ...input,
        reservedUsd,
        createdAt: now,
        inputRateUsdPerMillion: costUsd(input.model, 1_000_000, 0),
        outputRateUsdPerMillion: costUsd(input.model, 0, 1_000_000),
      },
    })
    return { ...verdict, reservationId: reservation.id }
  }, { isolationLevel: "ReadCommitted" })
}

/** Self-reported /tokens writes compete with gateway holds under the same locks. */
export async function recordTokenUsageUnderBudget(agent: GatewayBudgetAgent, usage: TokenUsageData): Promise<TokenBudgetVerdict & { logId?: string }> {
  costMicros(usage.costUsd)
  return db.$transaction(async (tx) => {
    const snapshot = await lockBudget(tx, agent)
    const chain = snapshot.chain
    const current = currentAgent(snapshot.current)
    assertBudgetUnfrozen(chain, agent.walletId)
    const now = new Date()
    const verdict = await checkBudget(tx, current, usage.costUsd, chain, now)
    if (verdict.exhausted) return verdict
    const log = await tx.tokenLog.create({ data: { agentId: agent.id, ...usage, createdAt: now } })
    return { ...verdict, logId: log.id }
  }, { isolationLevel: "ReadCommitted" })
}

function observedCost(rates: { inputRateUsdPerMillion: number; outputRateUsdPerMillion: number }, usage: GatewayUsage): number {
  const counts = [usage.tokensIn, usage.tokensOut, usage.cacheWriteTokens ?? 0, usage.cacheReadTokens ?? 0, usage.cacheWrite1hTokens ?? 0]
  if (counts.some((value) => !Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647)) {
    throw new Error("Invalid gateway token usage")
  }
  if ((usage.cacheWriteTokens ?? 0) + (usage.cacheReadTokens ?? 0) > usage.tokensIn || (usage.cacheWrite1hTokens ?? 0) > (usage.cacheWriteTokens ?? 0)) {
    throw new Error("Inconsistent gateway cache usage")
  }
  const write = usage.cacheWriteTokens ?? 0
  const write1h = usage.cacheWrite1hTokens ?? 0
  const read = usage.cacheReadTokens ?? 0
  const inputUnits = usage.tokensIn - write - read + (write - write1h) * 1.25 + write1h * 2 + read * 0.1
  return costMicros((inputUnits * rates.inputRateUsdPerMillion + usage.tokensOut * rates.outputRateUsdPerMillion) / MICROS_PER_USD) / MICROS_PER_USD
}

/** One reservation owns one log. Retrying after an ambiguous DB response cannot
 * double-charge, and unknown/partial usage never releases remaining capacity. */
export async function resolveGatewayBudget(reservationId: string, usage: GatewayUsage, complete: boolean): Promise<number> {
  const result = await db.$transaction(async (tx) => {
    const initial = await tx.gatewayReservation.findUniqueOrThrow({ where: { id: reservationId } })
    await lockBudget(tx, { id: initial.agentId, walletId: initial.walletId })
    const reservation = await tx.gatewayReservation.findUniqueOrThrow({ where: { id: reservationId, walletId: initial.walletId } })
    if (reservation.status === "settled") return { cost: reservation.observedUsd }
    if (reservation.status === "released") throw new Error("Cannot settle a released gateway reservation")
    // Provider aliases cannot switch the pricing basis after admission.
    const cost = observedCost(reservation, usage)
    if (complete && cost < reservation.observedUsd) throw new Error("Final gateway usage contradicts an earlier observation")
    const observedUsd = Math.max(reservation.observedUsd, cost)
    const now = new Date()
    const logData = { model: reservation.model, tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, costUsd: observedUsd, taskLabel: `gateway:${reservation.provider}` }
    await tx.tokenLog.upsert({
      where: { gatewayReservationId: reservationId },
      create: { agentId: reservation.agentId, gatewayReservationId: reservationId, ...logData, createdAt: now },
      update: {
        ...(cost >= reservation.observedUsd ? logData : {}),
        // Recognize a final charge in its settlement period, including when
        // an earlier partial observation was recorded before midnight.
        ...(complete ? { createdAt: now } : {}),
      },
    })
    await tx.gatewayReservation.update({
      where: { id: reservationId, walletId: reservation.walletId },
      data: { observedUsd, status: complete ? "settled" : "uncertain", ...(complete ? { settledAt: now } : {}) },
    })
    return {
      cost: observedUsd,
      ...(cost > reservation.reservedUsd && cost > reservation.observedUsd ? {
        overrun: { reservationId, agentId: reservation.agentId, walletId: reservation.walletId, reservedUsd: reservation.reservedUsd, observedUsd },
      } : {}),
    }
  }, { isolationLevel: "ReadCommitted" })
  if ("overrun" in result && result.overrun) log.warn("Gateway usage exceeded reserved estimate", result.overrun)
  return result.cost
}

/** Only call with affirmative evidence that the provider performed no work. */
export async function releaseGatewayBudget(reservationId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const initial = await tx.gatewayReservation.findUniqueOrThrow({ where: { id: reservationId } })
    await lockBudget(tx, { id: initial.agentId, walletId: initial.walletId })
    const reservation = await tx.gatewayReservation.findUniqueOrThrow({ where: { id: reservationId, walletId: initial.walletId } })
    if (reservation.status === "released" || reservation.status === "settled") return
    if (reservation.status !== "pending" || reservation.observedUsd !== 0) return
    await tx.gatewayReservation.update({
      where: { id: reservationId, walletId: reservation.walletId },
      data: { status: "released", settledAt: new Date() },
    })
  }, { isolationLevel: "ReadCommitted" })
}
