import { dailyPace } from "@/lib/burn"
import { fmtUsd } from "@/lib/format"

// Pure view logic for the Spend page: no IO, so it unit-tests without a
// database. The page fetches, this file decides what the numbers mean.
//
// One fact shapes everything here. A policy's daily and monthly limits are
// counted for each agent on its own: /authorize sums one agent's approved
// spend (approvedSpendSum(db, agent.id, …)) and the gateway sums one agent's
// model cost (agentSpentSince(agent.id, …)). Only the subtree caps add agents
// together. So a total for every agent is never compared with a per-agent
// limit; each agent is measured against its own.

export type MeterState = "ok" | "near" | "at"

export type MeterView = {
  /** Share of the limit used, rounded, capped at 999 for display. */
  pct: number
  /** Width of the filled part of the bar, 0 to 100. */
  fill: number
  state: MeterState
}

// From this share of a limit, a meter reads as close to it.
export const NEAR_PCT = 80

/**
 * A limit of zero is already reached: the gateway refuses at spent >= limit
 * and /authorize refuses any purchase that would take the total over it.
 */
export function meter(spent: number, limit: number): MeterView {
  if (limit <= 0) return { pct: 100, fill: 100, state: "at" }
  const pct = Math.min(999, Math.round((spent / limit) * 100))
  return {
    pct,
    fill: Math.max(0, Math.min(100, (spent / limit) * 100)),
    state: spent >= limit ? "at" : pct >= NEAR_PCT ? "near" : "ok",
  }
}

/** The server's time zone, short ("UTC", "CST"). Days and months reset on it. */
export function zoneLabel(now: Date): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" })
    .formatToParts(now)
    .find((p) => p.type === "timeZoneName")
  return part?.value ?? "server time"
}

/** One sentence under a daily meter: where today is heading, or that it has arrived. */
export function paceNote(spent: number, limit: number, now: Date): string | null {
  if (limit <= 0 || spent >= limit) return "At the limit. New requests are refused until the day resets."
  const pace = dailyPace(spent, limit, now)
  if (pace.onPace === null) return null
  if (!pace.exhaustAt) return `At this pace, about ${fmtUsd(pace.onPace)} by midnight.`
  const time = pace.exhaustAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short" })
  return `At this pace the limit is reached around ${time}.`
}

export type LimitAgent = {
  id: string
  name: string
  /** The agent's own limit, or the default from its wallet's policy. Cents; null = no limit applies. */
  modelLimitCents: number | null
  purchaseLimitCents: number | null
}

export type LimitRow = {
  id: string
  name: string
  kind: "model" | "purchases"
  spentUsd: number
  limitUsd: number
  view: MeterView
}

// An agent shows up once it has used this share of a daily limit.
export const WATCH_PCT = 50

/**
 * Agents that have used at least half of one of their own daily limits today,
 * the ones at a limit first. An agent with nothing spent is never listed.
 */
export function closestToLimit(
  agents: LimitAgent[],
  today: Map<string, { model: number; purchases: number }>,
): LimitRow[] {
  const rows: LimitRow[] = []
  for (const agent of agents) {
    const spent = today.get(agent.id)
    if (!spent) continue
    const pairs: Array<["model" | "purchases", number, number | null]> = [
      ["model", spent.model, agent.modelLimitCents],
      ["purchases", spent.purchases, agent.purchaseLimitCents],
    ]
    for (const [kind, spentUsd, limitCents] of pairs) {
      if (limitCents === null || spentUsd <= 0) continue
      const limitUsd = limitCents / 100
      const view = meter(spentUsd, limitUsd)
      if (view.state === "ok" && view.pct < WATCH_PCT) continue
      rows.push({ id: agent.id, name: agent.name, kind, spentUsd, limitUsd, view })
    }
  }
  const rank = (row: LimitRow) => (row.view.state === "at" ? 0 : 1)
  return rows.sort((a, b) => rank(a) - rank(b) || b.view.pct - a.view.pct || a.name.localeCompare(b.name))
}

/** Each amount as a share of the largest, 0 to 1, for a row's bar. */
export function shares(amounts: number[]): number[] {
  const max = Math.max(0, ...amounts)
  return amounts.map((amount) => (max > 0 ? Math.max(0, amount) / max : 0))
}

// Why a request was refused, in the words the Policy page uses. The machine
// code stays beside it on the page for anyone matching logs.
const REASONS: Record<string, string> = {
  PER_TXN_LIMIT: "over the largest single purchase",
  DAILY_BUDGET_EXCEEDED: "over its daily limit",
  MONTHLY_BUDGET_EXCEEDED: "over its monthly limit",
  SUBTREE_CAP_EXCEEDED: "over the cap shared by all agents",
  EXEC_BUDGET_EXCEEDED: "over the budget for one run",
  COST_PER_OUTCOME_CEILING: "cost per outcome over its ceiling",
  CATEGORY_BLOCKED: "a blocked category",
  CATEGORY_NOT_ALLOWED: "a category that is not on the allowed list",
  RESOURCE_BLOCKED: "a blocked resource",
  RESOURCE_NOT_ALLOWED: "a resource that is not on the allowed list",
  AMOUNT_MISMATCH: "an amount that does not add up",
  NO_POLICY: "no policy on its wallet",
  WALLET_FROZEN: "a frozen wallet",
  ESCALATION_TIMED_OUT: "nobody answered in time",
}

export function denialReason(code: string): string {
  return REASONS[code] ?? "refused by policy"
}
