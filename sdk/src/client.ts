import { DEFAULT_BASE_URL, request, requestRaw } from "./http"
import { AuthorizationDeniedError, SanctionError } from "./errors"
import type {
  AuthorizeInput,
  ClientOptions,
  Decision,
  ExecToken,
  ExecTokenInput,
  Fetch,
  InjectedCredential,
  LogTokensInput,
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

  constructor(apiKey: string, opts: ClientOptions = {}) {
    if (!apiKey) throw new Error("SanctionClient requires an agent API key (pxy_...)")
    this.apiKey = apiKey
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL
    this.fetch = opts.fetch ?? globalThis.fetch
  }

  private authHeaders(extra?: Record<string, string>): Record<string, string> {
    return { "x-api-key": this.apiKey, ...extra }
  }

  /**
   * Ask Sanction whether a spend is allowed. Call this BEFORE every costly or
   * sensitive action. A `denied` decision is returned (not thrown) so the agent
   * can replan — pass `{ throwOnDeny: true }` to raise instead.
   */
  async authorize(input: AuthorizeInput, opts: { throwOnDeny?: boolean } = {}): Promise<Decision> {
    const { status, body } = await requestRaw({
      baseUrl: this.baseUrl,
      fetch: this.fetch,
      method: "POST",
      path: "/authorize",
      headers: this.authHeaders(input.idempotencyKey ? { "idempotency-key": input.idempotencyKey } : undefined),
      body: {
        action: input.action,
        amount_usd: input.amountUsd,
        merchant: input.merchant,
        category: input.category,
        description: input.description,
      },
    })

    const b = body as Record<string, unknown> | undefined
    // 200 (approved/escalated) and 403-with-a-decision both carry a `status`
    // field — that's a real decision. Anything else (401/400/5xx) is an error.
    if (b && typeof b.status === "string") {
      const decision = toDecision(b)
      if (opts.throwOnDeny && decision.status === "denied") {
        throw new AuthorizationDeniedError({ reason: decision.reason, code: decision.code })
      }
      return decision
    }

    throw new SanctionError(
      (b?.error as string) ?? `Authorization request failed (${status})`,
      { status, code: b?.code as string | undefined, body },
    )
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
