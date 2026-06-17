import { DEFAULT_BASE_URL, request, requestRaw } from "./http"
import { AuthorizationDeniedError, SanctionError } from "./errors"
import { evaluateLocally, localDecision } from "./localPolicy"
import type {
  AgentClientOptions,
  AuthorizeInput,
  Decision,
  ExecToken,
  ExecTokenInput,
  Fetch,
  InjectedCredential,
  LogTokensInput,
  PolicyInput,
  WalletStats,
} from "./types"

/**
 * Data-plane client for an agent. Authenticates with the agent's `pxy_` API key.
 * Use this from inside the agent: gate spend before it happens, log token usage,
 * request scoped execution tokens, and inject credentials.
 */
export class SanctionClient {
  private readonly baseUrl: string
  private readonly fetch: Fetch
  private readonly apiKey: string
  private readonly localPolicy?: PolicyInput
  private readonly failClosed: boolean
  private readonly networkTimeoutMs: number
  private readonly offline: boolean

  // Best-effort local daily-spend tally (this process only), so offline budget
  // checks are meaningful. Resets at the UTC day boundary.
  private dailyKey = ""
  private dailySpentCents = 0
  // Decisions made locally during an outage, kept so the audit log can catch up
  // via syncOfflineDecisions(). Idempotency keys make replay safe.
  private readonly offlineQueue: Array<AuthorizeInput & { idempotencyKey: string }> = []

  constructor(apiKey: string, opts: AgentClientOptions = {}) {
    if (!apiKey) throw new Error("SanctionClient requires an agent API key (pxy_...)")
    this.apiKey = apiKey
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL
    this.fetch = opts.fetch ?? globalThis.fetch
    this.localPolicy = opts.localPolicy
    this.failClosed = opts.failClosed ?? true
    this.networkTimeoutMs = opts.networkTimeoutMs ?? 3000
    this.offline = opts.offline ?? false
  }

  private currentDailyCents(): number {
    const today = new Date().toISOString().slice(0, 10) // UTC YYYY-MM-DD
    if (today !== this.dailyKey) {
      this.dailyKey = today
      this.dailySpentCents = 0
    }
    return this.dailySpentCents
  }

  private trackApproved(amountUsd: number): void {
    this.currentDailyCents()
    this.dailySpentCents += Math.round(amountUsd * 100)
  }

  private authHeaders(extra?: Record<string, string>): Record<string, string> {
    return { "x-api-key": this.apiKey, ...extra }
  }

  /**
   * Ask Sanction whether a spend is allowed. Call this BEFORE every costly or
   * sensitive action. A `denied` decision is returned (not thrown) so the agent
   * can replan — pass `{ throwOnDeny: true }` to raise instead.
   *
   * Local-first: if Sanction is unreachable (or slower than `networkTimeoutMs`,
   * or the server 5xxs), the SDK decides locally against `localPolicy`. With no
   * local policy it fails closed (deny) unless `failClosed: false`. Genuine auth
   * errors (401/403/400) are NOT masked — they throw.
   */
  async authorize(input: AuthorizeInput, opts: { throwOnDeny?: boolean } = {}): Promise<Decision> {
    if (this.offline) return this.finishLocal(this.decideLocally(input), input, opts)

    let raw: { ok: boolean; status: number; body: unknown }
    try {
      raw = await requestRaw({
        baseUrl: this.baseUrl,
        fetch: this.fetch,
        method: "POST",
        path: "/authorize",
        timeoutMs: this.networkTimeoutMs,
        headers: this.authHeaders(input.idempotencyKey ? { "idempotency-key": input.idempotencyKey } : undefined),
        body: {
          action: input.action,
          amount_usd: input.amountUsd,
          merchant: input.merchant,
          category: input.category,
          description: input.description,
        },
      })
    } catch {
      // Network error / timeout / abort — Sanction is unreachable. Decide locally.
      return this.finishLocal(this.decideLocally(input), input, opts)
    }

    const b = raw.body as Record<string, unknown> | undefined
    // 200 (approved/escalated) and 403-with-a-decision both carry a `status`
    // field — that's a real remote decision.
    if (b && typeof b.status === "string") {
      const decision = toDecision(b)
      if (decision.status === "approved") this.trackApproved(decision.amountUsd)
      if (opts.throwOnDeny && decision.status === "denied") {
        throw new AuthorizationDeniedError({ reason: decision.reason, code: decision.code })
      }
      return decision
    }

    // Server-side outage (5xx) with no decision body — treat as unreachable.
    if (raw.status >= 500) return this.finishLocal(this.decideLocally(input), input, opts)

    // 401/400/etc — a real error, not an outage. Surface it.
    throw new SanctionError(
      (b?.error as string) ?? `Authorization request failed (${raw.status})`,
      { status: raw.status, code: b?.code as string | undefined, body: raw.body },
    )
  }

  /** Decide an authorization locally (used when Sanction is unreachable). */
  private decideLocally(input: AuthorizeInput): Decision {
    if (this.localPolicy) {
      const ev = evaluateLocally(this.localPolicy, input, this.currentDailyCents())
      return localDecision(ev, input)
    }
    // No local policy to evaluate against — fall back to the configured default.
    if (this.failClosed) {
      return localDecision(
        { status: "denied", code: "POLICY_DENIED", reason: "Sanction unreachable and no local policy; failing closed" },
        input,
      )
    }
    return localDecision({ status: "approved", reason: "Sanction unreachable; failing open (allow + log)" }, input)
  }

  /** Track budget, queue for audit sync, apply throwOnDeny — for any local decision. */
  private finishLocal(decision: Decision, input: AuthorizeInput, opts: { throwOnDeny?: boolean }): Decision {
    if (decision.status === "approved" || decision.status === "escalated") {
      if (decision.status === "approved") this.trackApproved(decision.amountUsd)
      const idempotencyKey = input.idempotencyKey ?? decision.requestId
      this.offlineQueue.push({ ...input, idempotencyKey })
    }
    if (opts.throwOnDeny && decision.status === "denied") {
      throw new AuthorizationDeniedError({ reason: decision.reason, code: decision.code })
    }
    return decision
  }

  /** Number of locally-decided actions waiting to be recorded server-side. */
  pendingOfflineDecisions(): number {
    return this.offlineQueue.length
  }

  /**
   * Replay locally-decided authorizations to Sanction so the audit log catches
   * up. Idempotency keys make this safe to call repeatedly. Best-effort: stops
   * on the first network failure and keeps the rest queued. Returns the count
   * successfully recorded.
   */
  async syncOfflineDecisions(): Promise<number> {
    let synced = 0
    while (this.offlineQueue.length > 0) {
      const item = this.offlineQueue[0]
      try {
        await requestRaw({
          baseUrl: this.baseUrl,
          fetch: this.fetch,
          method: "POST",
          path: "/authorize",
          timeoutMs: this.networkTimeoutMs,
          headers: this.authHeaders({ "idempotency-key": item.idempotencyKey }),
          body: { action: item.action, amount_usd: item.amountUsd, merchant: item.merchant, category: item.category, description: item.description },
        })
      } catch {
        break // still offline — leave the rest queued
      }
      this.offlineQueue.shift()
      synced++
    }
    return synced
  }

  /** Record an LLM inference's cost for budget tracking + audit. Fire-and-forget friendly. */
  async logTokens(input: LogTokensInput): Promise<void> {
    await request<void>({
      baseUrl: this.baseUrl,
      fetch: this.fetch,
      method: "POST",
      path: "/tokens",
      headers: this.authHeaders(),
      body: {
        model: input.model,
        tokens_in: input.tokensIn,
        tokens_out: input.tokensOut,
        cost_usd: input.costUsd,
        task: input.task,
      },
    })
  }

  /** Issue a short-lived (default 15min) scoped execution JWT for credential access. */
  async requestExecutionToken(input: ExecTokenInput): Promise<ExecToken> {
    const r = await request<Record<string, unknown>>({
      baseUrl: this.baseUrl,
      fetch: this.fetch,
      method: "POST",
      path: "/exec",
      headers: this.authHeaders(),
      body: {
        scope: input.scope,
        budget_usd: input.budgetUsd,
        ttl_seconds: input.ttlSeconds,
        container_id: input.containerId,
      },
    })
    return {
      jwt: r.jwt as string,
      jti: r.jti as string,
      expiresAt: r.expires_at as string,
      clearance: r.clearance as number,
      scope: (r.scope as string[]) ?? [],
      budgetUsd: r.budget_usd as number,
      ttlSeconds: r.ttl_seconds as number,
    }
  }

  /**
   * Inject a decrypted credential using an execution JWT (from requestExecutionToken).
   * The label must be in the token's scope. Every injection is audit-logged.
   */
  async injectCredential(executionJwt: string, label: string): Promise<InjectedCredential> {
    const r = await request<Record<string, unknown>>({
      baseUrl: this.baseUrl,
      fetch: this.fetch,
      method: "POST",
      path: "/credentials/inject",
      headers: { authorization: `Bearer ${executionJwt}` },
      body: { credential_label: label },
    })
    return {
      label: r.label as string,
      type: r.type as string,
      value: r.value as string,
      injectedAt: r.injected_at as string,
      expiresAt: r.expires_at as string,
    }
  }

  /** Convenience: request a token and immediately inject one credential from it. */
  async withCredential<T>(
    input: ExecTokenInput & { label: string },
    fn: (value: string, token: ExecToken) => Promise<T>,
  ): Promise<T> {
    const token = await this.requestExecutionToken(input)
    const cred = await this.injectCredential(token.jwt, input.label)
    return fn(cred.value, token)
  }

  /** Read today/month token cost, spend, and pending-approval count for a wallet. */
  async getStats(walletId: string): Promise<WalletStats> {
    const r = await request<Record<string, any>>({
      baseUrl: this.baseUrl,
      fetch: this.fetch,
      method: "GET",
      path: "/wallets/stats",
      headers: this.authHeaders(),
      query: { wallet_id: walletId },
    })
    return {
      today: {
        tokenCostUsd: r.today?.token_cost_usd ?? 0,
        tokensIn: r.today?.tokens_in ?? 0,
        tokensOut: r.today?.tokens_out ?? 0,
        spendUsd: r.today?.spend_usd ?? 0,
      },
      month: { tokenCostUsd: r.month?.token_cost_usd ?? 0, spendUsd: r.month?.spend_usd ?? 0 },
      pendingApprovals: r.pending_approvals ?? 0,
    }
  }
}

function toDecision(b: Record<string, unknown>): Decision {
  return {
    authorized: Boolean(b.authorized),
    status: b.status as Decision["status"],
    requestId: b.request_id as string,
    reason: b.reason as string | undefined,
    code: b.code as Decision["code"] | undefined,
    remediation: b.remediation as string | undefined,
    agent: b.agent as string,
    amountUsd: b.amount_usd as number,
    merchant: b.merchant as string,
  }
}
