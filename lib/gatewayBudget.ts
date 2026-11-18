import { db } from "./db"
import type { Prisma } from "./generated/prisma/client"
import { walletAncestorChain, type WalletBudgetNode } from "./cascadeBudget"
import { walletSubtreeIds } from "./poolAccess"
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
const UNRESOLVED = ["pending", "uncertain"]
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

/** Reservations and /tokens take the same wallet locks, then the agent lock.
 * Wallet locks include uncapped ancestors so sibling seats share a lock even
 * when a cap is newly enabled. The transaction ends before any provider IO. */
async function lockBudget(tx: Tx, agent: Pick<GatewayBudgetAgent, "id" | "walletId">): Promise<WalletBudgetNode[]> {
  const chain = await walletAncestorChain(tx, agent.walletId)
  if (!chain.length || chain[0].id !== agent.walletId || chain.at(-1)?.parentId !== null) {
    throw new Error("Incomplete wallet ancestry; token budget cannot be enforced")
  }
  for (const walletId of chain.map((node) => node.id).sort()) {
    const key = `token-budget:wallet:${walletId}`
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key})::int8)`
  }
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${agent.id})::int8)`
  // Read policy after acquiring locks. Membership changes require a retry so
  // an admission never proceeds while missing one of its current pool locks.
  const lockedChain = await walletAncestorChain(tx, agent.walletId)
  if (lockedChain.map((node) => node.id).join("/") !== chain.map((node) => node.id).join("/") || lockedChain.at(-1)?.parentId !== null) {
    throw new Error("Wallet ancestry changed during token budget admission")
  }
  return lockedChain
}

async function currentAgent(tx: Tx, agent: GatewayBudgetAgent): Promise<GatewayBudgetAgent> {
  const current = await tx.agent.findUnique({
    where: { id: agent.id, walletId: agent.walletId },
    include: { wallet: { include: { policy: true } } },
  })
  if (!current || !current.isActive || current.expiresAt && current.expiresAt <= new Date()) {
    throw new Error("Agent is no longer authorized to consume token budget")
  }
  return current
}

async function occupiedUsd(
  tx: Tx,
  scope: { agentId: string } | { walletIds: string[] },
  since: Date,
): Promise<number> {
  const logScope = "agentId" in scope
    ? { agentId: scope.agentId, OR: [{ gatewayReservationId: null }, { gatewayReservation: { status: "settled" } }] }
    : { OR: [
      { gatewayReservationId: null, agent: { walletId: { in: scope.walletIds } } },
      // A seat can move to another wallet while a request is in flight. Its
      // reserved call stays charged to the wallet that admitted it.
      { gatewayReservation: { walletId: { in: scope.walletIds }, status: "settled" } },
    ] }
  const holdScope = "agentId" in scope ? { agentId: scope.agentId } : { walletId: { in: scope.walletIds } }
  const [logs, holds] = await Promise.all([
    tx.tokenLog.aggregate({
      where: {
        ...logScope,
        createdAt: { gte: since },
        // An unresolved call's observation log is covered by its hold below.
      },
      _sum: { costUsd: true },
    }),
    tx.gatewayReservation.findMany({
      where: { ...holdScope, status: { in: UNRESOLVED } },
      select: { reservedUsd: true, observedUsd: true },
    }),
  ])
  const heldMicros = holds.reduce((sum, hold) => addMicros(sum, costMicros(Math.max(hold.reservedUsd, hold.observedUsd))), 0)
  return addMicros(costMicros(logs._sum.costUsd ?? 0), heldMicros) / MICROS_PER_USD
}

async function checkBudget(tx: Tx, agent: GatewayBudgetAgent, amount: number, chain: WalletBudgetNode[], now: Date): Promise<TokenBudgetVerdict> {
  const { day, month } = periods(now)
  const dailyCents = agent.dailyTokenBudgetUsd ?? agent.wallet.policy?.dailyTokenBudgetUsd
  const daily = dailyCents == null ? null : dailyCents / 100
  const spent = await occupiedUsd(tx, { agentId: agent.id }, day)
  if (dailyCents != null && exceeds(spent, amount, dailyCents)) return { exhausted: true, spent, budget: daily, horizon: "daily" }

  const monthlyCents = agent.monthlyTokenBudgetUsd ?? agent.wallet.policy?.monthlyTokenBudgetUsd
  if (monthlyCents != null) {
    const monthSpent = await occupiedUsd(tx, { agentId: agent.id }, month)
    if (exceeds(monthSpent, amount, monthlyCents)) return { exhausted: true, spent: monthSpent, budget: monthlyCents / 100, horizon: "monthly" }
  }
  for (const node of chain) {
    const capCents = node.policy?.subtreeDailyTokenCapUsd
    if (capCents == null) continue
    const subtree = await walletSubtreeIds(tx, node.id)
    // poolAccess bounds dashboard traversals; a truncated membership list is
    // not sufficient evidence to admit more spend.
    if (subtree.length >= 500) throw new Error("Token pool membership exceeds the enforcement traversal limit")
    if (!subtree.includes(agent.walletId) || await tx.wallet.findFirst({
      where: { parentId: { in: subtree }, id: { notIn: subtree } },
      select: { id: true },
    })) throw new Error("Incomplete token pool membership; budget cannot be enforced")
    const poolSpent = await occupiedUsd(tx, { walletIds: subtree }, day)
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
    const chain = await lockBudget(tx, agent)
    const current = await currentAgent(tx, agent)
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
    const chain = await lockBudget(tx, agent)
    const current = await currentAgent(tx, agent)
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
