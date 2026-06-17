/**
 * In-memory mock of the Sanction control plane — a fake `fetch` you inject into
 * the SDK clients (`new SanctionClient(key, { fetch })`). It exists so this whole
 * example runs deterministically with NO network and NO live API: great for CI,
 * and it doubles as executable documentation of what the real endpoints do.
 *
 * It faithfully re-implements the *enforced* parts of the policy engine:
 *   - POST  /wallets             → mint a wallet + one-time sk_ management key
 *   - POST  /agents              → register an agent + one-time pxy_ key
 *   - PATCH /wallets/policy      → apply / partial-update a policy (cents)
 *   - GET   /wallets/policy      → read it back
 *   - POST  /authorize           → the decision engine (the heart of the demo)
 *   - POST  /tokens              → log LLM token cost (budget + audit)
 *   - POST  /exec                → issue a scoped 15-min execution JWT
 *   - POST  /credentials/inject  → exchange JWT + label for a decrypted secret
 *   - GET   /wallets/stats       → today/month rollups for the morning review
 *
 * The authorize decision ORDER mirrors app/api/v1/authorize/route.ts exactly:
 *   1. no policy                       → denied    (NO_POLICY)
 *   2. category in blockedCategories   → denied    (CATEGORY_BLOCKED)
 *   3. amount > perTransactionMaxUsd   → denied    (PER_TXN_LIMIT)
 *   4. (atomic) approvedToday + amount
 *        > dailySpendBudgetUsd         → denied    (DAILY_BUDGET_EXCEEDED)
 *   5. amount > escalateOverUsd        → escalated (ESCALATION_REQUIRED)
 *   6. otherwise                       → approved
 *
 * All policy amounts are INTEGER CENTS, matching the real API and Prisma schema.
 */

import type { Fetch } from "../../../sdk/src/types.ts"

// Decision codes + remediation, copied verbatim from lib/decisions.ts so the
// mock's responses are byte-for-byte what an agent sees against the live API.
type DecisionCode =
  | "ESCALATION_REQUIRED"
  | "NO_POLICY"
  | "CATEGORY_BLOCKED"
  | "PER_TXN_LIMIT"
  | "DAILY_BUDGET_EXCEEDED"
  | "POLICY_DENIED"

const REMEDIATION: Record<DecisionCode, string> = {
  ESCALATION_REQUIRED:
    "Over the auto-approve threshold; a human must approve. Poll request_id for status, or wait for the escalation to resolve.",
  NO_POLICY:
    "No spend policy is configured for this wallet. The owner must create one before purchases can be authorized.",
  CATEGORY_BLOCKED:
    "This category is on the wallet's blocked list. Use an allowed category or ask the owner to unblock it.",
  PER_TXN_LIMIT:
    "Amount exceeds the per-transaction limit. Split into smaller charges or ask the owner to raise the limit.",
  DAILY_BUDGET_EXCEEDED:
    "The wallet's daily spend budget is exhausted. Retry after the daily reset or ask the owner to raise the budget.",
  POLICY_DENIED: "Denied by policy. Review the reason and adjust the request.",
}

const REASON: Record<DecisionCode, string> = {
  NO_POLICY: "No policy configured",
  CATEGORY_BLOCKED: "Category is blocked",
  PER_TXN_LIMIT: "Exceeds per-transaction limit",
  DAILY_BUDGET_EXCEEDED: "Daily spend budget exceeded",
  ESCALATION_REQUIRED: "Over auto-approve threshold; human approval required",
  POLICY_DENIED: "Denied by policy",
}

interface PolicyState {
  dailyTokenBudgetUsd: number
  dailySpendBudgetUsd: number
  perTransactionMaxUsd: number
  autoApproveUnderUsd: number
  escalateOverUsd: number
  allowedCategories: string[]
  blockedCategories: string[]
  updatedAt: string
}

interface WalletState {
  id: string
  name: string
  ownerEmail: string
  managementKey: string
  policy: PolicyState | null
}

interface AgentState {
  id: string
  name: string
  apiKey: string
  walletId: string
}

interface AuthRecord {
  status: "approved" | "denied" | "escalated"
  amountUsd: number
  idempotencyKey?: string
}

interface TokenRecord {
  costUsd: number
  tokensIn: number
  tokensOut: number
}

interface ExecRecord {
  jti: string
  walletId: string
  scope: string[]
  expiresAt: number
}

/**
 * A tiny seedable credential vault. In production these are AES-256-GCM encrypted
 * at rest and only decrypted behind a valid execution JWT; here they are plain
 * mock strings so the example is self-contained.
 */
export interface MockCredential {
  label: string
  type: string
  value: string
}

let idSeq = 0
const nextId = (prefix: string) => `${prefix}_${(++idSeq).toString(36).padStart(6, "0")}`

export interface MockServer {
  fetch: Fetch
  /** Seed a credential into a wallet's vault so /exec + /inject can serve it. */
  seedCredential(walletId: string, cred: MockCredential): void
}

/** Build an isolated in-memory Sanction server and return its fake `fetch`. */
export function createMockSanction(): MockServer {
  const wallets = new Map<string, WalletState>()
  const walletsByMgmtKey = new Map<string, WalletState>()
  const agents = new Map<string, AgentState>() // keyed by api key
  const auths = new Map<string, AuthRecord[]>() // keyed by walletId
  const tokens = new Map<string, TokenRecord[]>() // keyed by walletId
  const credentials = new Map<string, MockCredential[]>() // keyed by walletId
  const execTokens = new Map<string, ExecRecord>() // keyed by jwt

  const json = (status: number, body: unknown): Response =>
    ({
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body),
    }) as Response

  function walletForAgent(apiKey: string | undefined): WalletState | undefined {
    if (!apiKey) return undefined
    const agent = agents.get(apiKey)
    return agent ? wallets.get(agent.walletId) : undefined
  }

  // Build a decision response that matches app/api/v1/authorize/route.ts.
  function decision(
    status: AuthRecord["status"],
    body: Record<string, unknown>,
    agentName: string,
    code: DecisionCode | undefined,
  ): Response {
    const authorized = status === "approved"
    // approved + escalated come back HTTP 200; denied comes back 403 — but the
    // body always carries a `status` field, so the SDK treats all three as
    // decisions (not errors) and the agent branches on `decision.status`.
    const httpStatus = status === "denied" ? 403 : 200
    return json(httpStatus, {
      authorized,
      status,
      request_id: nextId("req"),
      reason: code ? REASON[code] : undefined,
      code: code ?? null,
      remediation: code ? REMEDIATION[code] : undefined,
      agent: agentName,
      amount_usd: body.amount_usd,
      merchant: body.merchant,
    })
  }

  const fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input))
    const path = url.pathname.replace(/^.*\/api\/v1/, "") || url.pathname
    const method = (init.method ?? "GET").toUpperCase()
    const headers = normalizeHeaders(init.headers)
    const body = init.body ? JSON.parse(String(init.body)) : {}

    // ---- Management plane (x-mgmt-key) -------------------------------------

    if (path === "/wallets" && method === "POST") {
      const id = nextId("wal")
      const managementKey = nextId("sk")
      const w: WalletState = { id, name: body.name, ownerEmail: body.owner_email, managementKey, policy: null }
      wallets.set(id, w)
      walletsByMgmtKey.set(managementKey, w)
      auths.set(id, [])
      tokens.set(id, [])
      return json(201, {
        id,
        name: w.name,
        owner_email: w.ownerEmail,
        management_key: managementKey,
        management_key_prefix: managementKey.slice(0, 8),
      })
    }

    if (path === "/agents" && method === "POST") {
      const w = walletsByMgmtKey.get(headers["x-mgmt-key"])
      if (!w) return json(401, { error: "Invalid management key" })
      const id = nextId("agt")
      const apiKey = nextId("pxy")
      agents.set(apiKey, { id, name: body.name, apiKey, walletId: w.id })
      return json(201, { id, name: body.name, api_key: apiKey, api_key_prefix: apiKey.slice(0, 8), wallet_id: w.id })
    }

    if (path === "/wallets/policy" && method === "PATCH") {
      const w = walletsByMgmtKey.get(headers["x-mgmt-key"])
      if (!w) return json(401, { error: "Invalid management key" })
      // Partial update: omitted fields are unchanged. Start from current/defaults.
      const cur: PolicyState = w.policy ?? {
        dailyTokenBudgetUsd: 0,
        dailySpendBudgetUsd: 0,
        perTransactionMaxUsd: 0,
        autoApproveUnderUsd: 0,
        escalateOverUsd: 0,
        allowedCategories: [],
        blockedCategories: [],
        updatedAt: new Date().toISOString(),
      }
      const next: PolicyState = {
        ...cur,
        ...pick(body, [
          "dailyTokenBudgetUsd",
          "dailySpendBudgetUsd",
          "perTransactionMaxUsd",
          "autoApproveUnderUsd",
          "escalateOverUsd",
          "allowedCategories",
          "blockedCategories",
        ]),
        updatedAt: new Date().toISOString(),
      }
      w.policy = next
      return json(200, { wallet_id: w.id, policy: next })
    }

    if (path === "/wallets/policy" && method === "GET") {
      const w = walletsByMgmtKey.get(headers["x-mgmt-key"])
      if (!w) return json(401, { error: "Invalid management key" })
      return json(200, { wallet_id: w.id, policy: w.policy })
    }

    // ---- Data plane (x-api-key) -------------------------------------------

    if (path === "/authorize" && method === "POST") {
      const w = walletForAgent(headers["x-api-key"])
      if (!w) return json(401, { error: "Invalid API key" })
      const agentName = agents.get(headers["x-api-key"])!.name
      const idem = headers["idempotency-key"]
      const records = auths.get(w.id)!

      // Idempotent replay: same key returns the original decision.
      if (idem) {
        const prior = records.find((r) => r.idempotencyKey === idem)
        if (prior) {
          const code =
            prior.status === "approved"
              ? undefined
              : prior.status === "escalated"
                ? "ESCALATION_REQUIRED"
                : "POLICY_DENIED"
          return decision(prior.status, body, agentName, code)
        }
      }

      const amount = body.amount_usd as number
      const category = body.category as string
      const amountCents = Math.round(amount * 100)
      const policy = w.policy

      const persist = (status: AuthRecord["status"]): AuthRecord["status"] => {
        records.push({ status, amountUsd: amount, idempotencyKey: idem })
        return status
      }

      // 1. No policy → deny.
      if (!policy) return decision(persist("denied"), body, agentName, "NO_POLICY")
      // 2. Blocked category (exact match) → deny.
      if (policy.blockedCategories.includes(category)) return decision(persist("denied"), body, agentName, "CATEGORY_BLOCKED")
      // 3. Over per-transaction ceiling → deny.
      if (amountCents > policy.perTransactionMaxUsd) return decision(persist("denied"), body, agentName, "PER_TXN_LIMIT")
      // 4. Atomic daily-spend cap: today's APPROVED spend + this amount.
      const approvedToday = records.filter((r) => r.status === "approved").reduce((s, r) => s + r.amountUsd, 0)
      if (Math.round((approvedToday + amount) * 100) > policy.dailySpendBudgetUsd)
        return decision(persist("denied"), body, agentName, "DAILY_BUDGET_EXCEEDED")
      // 5. Over escalate threshold → escalate (pause for a human).
      if (amountCents > policy.escalateOverUsd) return decision(persist("escalated"), body, agentName, "ESCALATION_REQUIRED")
      // 6. Otherwise → approve.
      return decision(persist("approved"), body, agentName, undefined)
    }

    if (path === "/tokens" && method === "POST") {
      const w = walletForAgent(headers["x-api-key"])
      if (!w) return json(401, { error: "Invalid API key" })
      tokens.get(w.id)!.push({
        costUsd: body.cost_usd ?? 0,
        tokensIn: body.tokens_in ?? 0,
        tokensOut: body.tokens_out ?? 0,
      })
      return json(200, { logged: true })
    }

    if (path === "/exec" && method === "POST") {
      const w = walletForAgent(headers["x-api-key"])
      if (!w) return json(401, { error: "Invalid API key" })
      const vault = credentials.get(w.id) ?? []
      const scope = body.scope as string[]
      const denied = scope.filter((s) => !vault.find((c) => c.label === s))
      if (denied.length > 0) return json(403, { error: "Agent not authorized for credentials", denied })

      const ttl = body.ttl_seconds ?? 900
      const jti = nextId("jti")
      // The "JWT" is opaque here — the mock /inject keys off it directly.
      const jwt = `mockjwt.${jti}`
      const expiresAt = Date.now() + ttl * 1000
      execTokens.set(jwt, { jti, walletId: w.id, scope, expiresAt })
      return json(200, {
        jwt,
        jti,
        expires_at: new Date(expiresAt).toISOString(),
        clearance: 3,
        scope,
        budget_usd: body.budget_usd,
        ttl_seconds: ttl,
      })
    }

    if (path === "/credentials/inject" && method === "POST") {
      // Note: injection authenticates with the Bearer execution JWT, NOT x-api-key.
      const auth = headers["authorization"] ?? ""
      const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : ""
      const exec = execTokens.get(jwt)
      if (!exec) return json(401, { error: "Invalid or expired JWT" })
      if (exec.expiresAt < Date.now()) return json(401, { error: "Execution token expired or revoked" })
      const label = body.credential_label as string
      if (!exec.scope.includes(label)) return json(403, { error: `'${label}' not in JWT scope` })
      const cred = (credentials.get(exec.walletId) ?? []).find((c) => c.label === label)
      if (!cred) return json(404, { error: "Credential not found" })
      return json(200, {
        label: cred.label,
        type: cred.type,
        value: cred.value, // decrypted-credential equivalent
        injected_at: new Date().toISOString(),
        expires_at: new Date(exec.expiresAt).toISOString(),
      })
    }

    if (path === "/wallets/stats" && method === "GET") {
      const walletId = url.searchParams.get("wallet_id") ?? ""
      // Real endpoint accepts mgmt-key OR an agent key in the wallet; accept either.
      const w = walletsByMgmtKey.get(headers["x-mgmt-key"]) ?? walletForAgent(headers["x-api-key"])
      if (!w || w.id !== walletId) return json(401, { error: "Unauthorized" })
      const t = tokens.get(w.id)!
      const a = auths.get(w.id)!
      const approvedSpend = a.filter((r) => r.status === "approved").reduce((s, r) => s + r.amountUsd, 0)
      const tokenCost = t.reduce((s, r) => s + r.costUsd, 0)
      return json(200, {
        today: {
          token_cost_usd: round(tokenCost),
          tokens_in: t.reduce((s, r) => s + r.tokensIn, 0),
          tokens_out: t.reduce((s, r) => s + r.tokensOut, 0),
          spend_usd: round(approvedSpend),
        },
        month: { token_cost_usd: round(tokenCost), spend_usd: round(approvedSpend) },
        pending_approvals: a.filter((r) => r.status === "escalated").length,
      })
    }

    return json(404, { error: `mock has no route for ${method} ${path}` })
  }) as unknown as Fetch

  return {
    fetch,
    seedCredential(walletId, cred) {
      const list = credentials.get(walletId) ?? []
      list.push(cred)
      credentials.set(walletId, list)
    },
  }
}

function normalizeHeaders(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!h) return out
  if (h instanceof Headers) {
    h.forEach((v, k) => (out[k.toLowerCase()] = v))
  } else if (Array.isArray(h)) {
    for (const [k, v] of h) out[k.toLowerCase()] = v
  } else {
    for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = String(v)
  }
  return out
}

function pick<T extends Record<string, unknown>>(obj: T, keys: string[]): Partial<T> {
  const out: Record<string, unknown> = {}
  for (const k of keys) if (k in obj && obj[k] !== undefined) out[k] = obj[k]
  return out as Partial<T>
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
