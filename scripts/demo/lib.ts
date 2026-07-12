// Shared plumbing for the demo-company driver: a thin REST client over the
// public API (the same surface a customer touches — no direct DB access), the
// persona manifest types, and the gitignored key store.

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"

export const API_URL = process.env.SANCTION_API_URL ?? "http://localhost:3000/api/v1"

type Auth = { mgmt: string } | { agent: string } | { bearer: string } | undefined

export async function call<T = Record<string, unknown>>(
  path: string,
  opts: { method?: "GET" | "POST" | "PATCH"; auth?: Auth; body?: unknown } = {},
): Promise<{ status: number; json: T }> {
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (opts.auth && "mgmt" in opts.auth) headers["x-mgmt-key"] = opts.auth.mgmt
  if (opts.auth && "agent" in opts.auth) headers["x-api-key"] = opts.auth.agent
  if (opts.auth && "bearer" in opts.auth) headers["authorization"] = `Bearer ${opts.auth.bearer}`
  const res = await fetch(`${API_URL}${path}`, {
    method: opts.method ?? (opts.body ? "POST" : "GET"),
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  const json = (await res.json().catch(() => ({}))) as T
  return { status: res.status, json }
}

export function fail(msg: string): never {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

/** Shared rough weekday rhythm for history generators (dayIndex counts back
 *  from yesterday) — one formula so the personas can't drift. */
export function isWeekday(dayIndex: number): boolean {
  return (dayIndex + 3) % 7 < 5
}

// ── Persona manifest ────────────────────────────────────────────────────────

export type PolicyPatch = Record<string, unknown> // policyInputSchema field names, dollars

export type SeatSpec = {
  name: string
  holder: string
  /** contractor auto-shutoff: an ISO datetime, or "past" to seed an
   *  already-expired seat (the fail-closed story, live on stage) */
  expiresAt?: "past" | string
  /** PATCH /v1/agents overrides after creation (budget lines, clearance). */
  overrides?: Record<string, unknown>
  /** A job archetype (see ROLE_PROFILES). `liven` uses it to generate a
   *  believable spread of today's token burn + light spend per seat, so a
   *  50-seat org hums without hand-authoring every line. Seats without a role
   *  get no baseline burn (the curated-moment seats keep their exact numbers). */
  role?: RoleKey
}

export type VaultSpec = { label: string; type: string; value: string; min_clearance?: number }

export type SpendSpec = {
  seat: string // seat name
  action: "purchase" | "subscribe" | "transfer"
  amount_usd: number
  merchant: string
  category: string
  description?: string
  tags?: Record<string, string>
  /** What the engine must return — the pulse is a self-verifying test. */
  expect: "approved" | "escalated" | "denied"
  /** escalated only: approve via the owner API and redeem the grant (a completed story), or leave pending for the live demo. */
  then?: "approve-and-redeem" | "leave-pending"
}

export type ToolCallSpec = {
  seat: string
  tool: string
  server?: string
  expect: "allowed" | "escalated" | "denied" // tool decisions say "allowed", not "approved"
  then?: "leave-pending"
}

export type TokenLogSpec = {
  seat: string
  model: string
  tokens_in: number
  tokens_out: number
  cost_usd: number
  task: string
  /** expect a 402 (the seat's line or a pooled cap already spent) */
  expectDenied?: boolean
}

export type OutcomeSpec = {
  seat: string
  kind: string // must match the pool policy's outcome_kind for ceiling governance
  value_usd?: number
  play?: string
  dedupe_key: string
  /** set by the history runner to land the outcome in the right day */
  occurred_at?: string
}

export type PoolSpec = {
  name: string
  policy: PolicyPatch
  seats: SeatSpec[]
  vault?: VaultSpec[]
}

/** One day of traffic for `history` — same self-verifying specs as pulse. */
export type DayPlan = {
  tokens: TokenLogSpec[]
  spends: SpendSpec[]
  outcomes?: OutcomeSpec[]
}

export type Persona = {
  key: string
  company: string
  companyPolicy: PolicyPatch
  pools: PoolSpec[]
  pulse: {
    tokens: TokenLogSpec[]
    spends: SpendSpec[]
    tools: ToolCallSpec[]
    /** exec→inject round-trip: seat requests a scoped JWT and injects a label. */
    injections: { seat: string; label: string; budget_usd: number }[]
    outcomes?: OutcomeSpec[]
    /** seats whose key must already fail closed (contractor expiry story) */
    expiredSeats?: string[]
    /** staged kill-switch: pulse freezes these pools before spending (idempotent) */
    freezePools?: { pool: string; reason: string }[]
  }
  /** deterministic generator for `history --days N`: dayIndex counts back from
   *  yesterday (1 = yesterday). Keep each day's totals inside the daily caps —
   *  every day runs against a clean (backdated) budget state. */
  history?: (dayIndex: number) => DayPlan
  /** API-only staging for targets without DB access (no backdating possible):
   *  today's spends + past outcomes (occurred_at is a first-class API field)
   *  arm windowed state like the cost-per-outcome ceiling. Run once, before
   *  the first pulse. */
  prime?: {
    spends: SpendSpec[]
    outcomes: (OutcomeSpec & { days_ago: number })[]
  }
}

// ── Role profiles: turn a 50-seat roster into a living org ──────────────────
// Each seat's `role` maps to a believable daily footprint — the model it runs,
// its typical token burn, the tasks it labels, and an occasional small approved
// purchase. `liven` reads these so the whole org shows activity without every
// line being hand-authored. Numbers are deliberately modest and well under the
// (raised) pool caps, so livening never trips a budget and never denies.

export type RoleKey =
  | "engineer" | "data-scientist" | "analyst" | "marketer" | "media-buyer"
  | "support" | "researcher" | "ops" | "paralegal" | "associate" | "designer"

type RoleProfile = {
  model: string
  tokensIn: number
  tokensOut: number
  costUsd: number
  tasks: string[]
  // Occasional small purchase this role plausibly makes (always auto-approved).
  buy?: { merchant: string; category: string; amountUsd: number; description: string }
}

export const ROLE_PROFILES: Record<RoleKey, RoleProfile> = {
  engineer: { model: "claude-sonnet-4-6", tokensIn: 420_000, tokensOut: 62_000, costUsd: 6.4, tasks: ["pr-review", "test-triage", "refactor-plan", "incident-summary"], buy: { merchant: "GitHub", category: "software", amountUsd: 21, description: "Copilot seat top-up" } },
  "data-scientist": { model: "claude-sonnet-4-6", tokensIn: 560_000, tokensOut: 88_000, costUsd: 8.9, tasks: ["feature-eval", "notebook-run", "model-scorecard", "dataset-profile"], buy: { merchant: "Weights & Biases", category: "software", amountUsd: 40, description: "Experiment tracking seat" } },
  analyst: { model: "claude-haiku-4-5", tokensIn: 240_000, tokensOut: 34_000, costUsd: 2.6, tasks: ["dashboard-refresh", "cohort-cut", "kpi-digest"], buy: { merchant: "Mode", category: "software", amountUsd: 18, description: "Query credits" } },
  marketer: { model: "claude-sonnet-4-6", tokensIn: 300_000, tokensOut: 72_000, costUsd: 5.3, tasks: ["campaign-copy", "landing-variants", "lifecycle-sequences"], buy: { merchant: "Canva", category: "marketing", amountUsd: 24, description: "Asset pack" } },
  "media-buyer": { model: "gemini-2.5-pro", tokensIn: 260_000, tokensOut: 32_000, costUsd: 2.5, tasks: ["serp-analysis", "bid-plan", "creative-variants"], buy: { merchant: "Google Ads", category: "marketing", amountUsd: 35, description: "Prospecting flight" } },
  support: { model: "claude-haiku-4-5", tokensIn: 200_000, tokensOut: 26_000, costUsd: 1.9, tasks: ["ticket-triage", "kb-answer", "csat-summary"], buy: { merchant: "Zendesk", category: "software", amountUsd: 12, description: "Sandbox add-on" } },
  researcher: { model: "claude-sonnet-4-6", tokensIn: 480_000, tokensOut: 76_000, costUsd: 7.4, tasks: ["lit-review", "market-scan", "synthesis"], buy: { merchant: "arXiv Sanity", category: "research", amountUsd: 15, description: "API tier" } },
  ops: { model: "gpt-4o", tokensIn: 340_000, tokensOut: 48_000, costUsd: 4.6, tasks: ["runbook-check", "forecast-refresh", "vendor-review"], buy: { merchant: "Ramp", category: "services", amountUsd: 20, description: "Spend export add-on" } },
  paralegal: { model: "claude-sonnet-4-6", tokensIn: 300_000, tokensOut: 52_000, costUsd: 5.4, tasks: ["clause-comparison", "diligence-review", "filing-prep"], buy: { merchant: "PACER", category: "legal", amountUsd: 22, description: "Docket pull credits" } },
  associate: { model: "claude-sonnet-4-6", tokensIn: 520_000, tokensOut: 90_000, costUsd: 8.7, tasks: ["brief-draft", "deposition-summary", "memo"], buy: { merchant: "Westlaw", category: "legal", amountUsd: 34, description: "Research session" } },
  designer: { model: "claude-sonnet-4-6", tokensIn: 180_000, tokensOut: 40_000, costUsd: 3.1, tasks: ["mock-review", "design-critique", "spec-copy"], buy: { merchant: "Figma", category: "software", amountUsd: 16, description: "Dev-mode seat" } },
}

// Deterministic per-seat jitter (no Math.random — kept reproducible like the
// rest of the driver). Small ± swing so 50 seats don't look copy-pasted.
function jitter(seed: string, spread: number): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) & 0xffff
  return ((h % (spread * 2 + 1)) - spread) / 100
}

/** Today's baseline burn for every roled seat: two token logs (varied task) and,
 *  for most seats, one small auto-approved purchase. Curated-moment seats (no
 *  role) are untouched, so `liven` composes with the existing pulse story. */
export function baselineActivity(pools: PoolSpec[]): { tokens: TokenLogSpec[]; spends: SpendSpec[] } {
  const tokens: TokenLogSpec[] = []
  const spends: SpendSpec[] = []
  for (const pool of pools) {
    for (const seat of pool.seats) {
      if (!seat.role) continue
      const p = ROLE_PROFILES[seat.role]
      const j = jitter(seat.name, 12) // ±0.12 cost swing
      tokens.push(
        { seat: seat.name, model: p.model, tokens_in: p.tokensIn, tokens_out: p.tokensOut, cost_usd: Math.round((p.costUsd + j) * 100) / 100, task: p.tasks[0] },
        { seat: seat.name, model: p.model, tokens_in: Math.round(p.tokensIn * 0.6), tokens_out: Math.round(p.tokensOut * 0.6), cost_usd: Math.round((p.costUsd * 0.6 + j) * 100) / 100, task: p.tasks[(seat.name.length % (p.tasks.length - 1)) + 1] },
      )
      // ~2 of every 3 seats make a small purchase — enough to fill "by category"
      // without a wall of identical rows.
      if (p.buy && seat.name.length % 3 !== 0) {
        spends.push({ seat: seat.name, action: "purchase", amount_usd: p.buy.amountUsd, merchant: p.buy.merchant, category: p.buy.category, description: p.buy.description, expect: "approved" })
      }
    }
  }
  return { tokens, spends }
}

// ── Key store (gitignored — raw sk_/pxy_ keys never enter the repo) ─────────

export type Keys = {
  company?: { walletId: string; mgmtKey: string }
  pools: Record<string, { walletId: string; mgmtKey: string }>
  seats: Record<string, { agentId: string; apiKey: string; poolName: string }>
  /** request ids left escalated on purpose — `pulse --watch` polls and redeems. */
  pending: { requestId: string; seat: string; kind: "spend" | "tool"; retry: Record<string, unknown> }[]
}

// Keystores default to this directory, but DEMO_KEYS_DIR redirects them — so a
// local dry-run against a throwaway tree never touches the production keystore
// that lives here. One target, one keystore dir.
const keysDir = () => process.env.DEMO_KEYS_DIR ?? import.meta.dirname
const keysPath = (persona: string) => join(keysDir(), `.keys.${persona}.json`)

// HQ is one root wallet shared by every persona — its keys live in their own
// store so the second persona's seed finds it instead of re-claiming the email.
export type HqKeys = { walletId: string; mgmtKey: string }

export function loadHq(): HqKeys | null {
  if (!existsSync(keysPath("hq"))) return null
  return JSON.parse(readFileSync(keysPath("hq"), "utf8")) as HqKeys
}

export function saveHq(hq: HqKeys) {
  writeFileSync(keysPath("hq"), JSON.stringify(hq, null, 2))
}

export function loadKeys(persona: string): Keys {
  if (!existsSync(keysPath(persona))) return { pools: {}, seats: {}, pending: [] }
  return JSON.parse(readFileSync(keysPath(persona), "utf8")) as Keys
}

export function saveKeys(persona: string, keys: Keys) {
  writeFileSync(keysPath(persona), JSON.stringify(keys, null, 2))
}
