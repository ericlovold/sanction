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
}

// ── Key store (gitignored — raw sk_/pxy_ keys never enter the repo) ─────────

export type Keys = {
  company?: { walletId: string; mgmtKey: string }
  pools: Record<string, { walletId: string; mgmtKey: string }>
  seats: Record<string, { agentId: string; apiKey: string; poolName: string }>
  /** request ids left escalated on purpose — `pulse --watch` polls and redeems. */
  pending: { requestId: string; seat: string; kind: "spend" | "tool"; retry: Record<string, unknown> }[]
}

const keysPath = (persona: string) => join(import.meta.dirname, `.keys.${persona}.json`)

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
