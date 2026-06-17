import { DEFAULT_BASE_URL, request } from "./http"
import type {
  AuditEventsPage,
  ClientOptions,
  CreateWalletInput,
  CreatedAgent,
  CreatedWallet,
  DailySummary,
  Fetch,
  Policy,
  PolicyBlueprint,
  PolicyInput,
  RegisterAgentInput,
} from "./types"

/**
 * Management-plane client for a wallet owner. Authenticates with the wallet's
 * `sk_` management key. Use this to register agents and manage policy — never
 * ship this key inside an agent.
 *
 * `createWallet` is static because it is the unauthenticated sign-up entry point
 * that mints the management key.
 */
export class SanctionAdminClient {
  private readonly baseUrl: string
  private readonly fetch: Fetch
  private readonly mgmtKey: string

  constructor(managementKey: string, opts: ClientOptions = {}) {
    if (!managementKey) throw new Error("SanctionAdminClient requires a management key (sk_...)")
    this.mgmtKey = managementKey
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL
    this.fetch = opts.fetch ?? globalThis.fetch
  }

  /** Create a wallet. Returns the one-time management key — store it immediately. */
  static async createWallet(input: CreateWalletInput, opts: ClientOptions = {}): Promise<CreatedWallet> {
    const r = await request<Record<string, unknown>>({
      baseUrl: opts.baseUrl ?? DEFAULT_BASE_URL,
      fetch: opts.fetch ?? globalThis.fetch,
      method: "POST",
      path: "/wallets",
      body: { name: input.name, owner_email: input.ownerEmail },
    })
    return {
      id: r.id as string,
      name: r.name as string,
      ownerEmail: r.owner_email as string,
      managementKey: r.management_key as string,
      managementKeyPrefix: r.management_key_prefix as string,
    }
  }

  private mgmtHeaders(): Record<string, string> {
    return { "x-mgmt-key": this.mgmtKey }
  }

  /** Register an agent under a wallet. Returns its one-time data-plane key (pxy_). */
  async registerAgent(input: RegisterAgentInput): Promise<CreatedAgent> {
    const r = await request<Record<string, unknown>>({
      baseUrl: this.baseUrl,
      fetch: this.fetch,
      method: "POST",
      path: "/agents",
      headers: this.mgmtHeaders(),
      body: { wallet_id: input.walletId, name: input.name },
    })
    return {
      id: r.id as string,
      name: r.name as string,
      apiKey: r.api_key as string,
      apiKeyPrefix: r.api_key_prefix as string,
      walletId: r.wallet_id as string,
    }
  }

  /** Read the wallet's current policy. */
  async getPolicy(walletId: string): Promise<Policy> {
    const r = await request<{ policy: Policy }>({
      baseUrl: this.baseUrl,
      fetch: this.fetch,
      method: "GET",
      path: "/wallets/policy",
      headers: this.mgmtHeaders(),
      query: { wallet_id: walletId },
    })
    return r.policy
  }

  /** Partial-update the wallet's policy. Omitted fields are unchanged. */
  async updatePolicy(walletId: string, policy: PolicyInput): Promise<Policy> {
    const r = await request<{ policy: Policy }>({
      baseUrl: this.baseUrl,
      fetch: this.fetch,
      method: "PATCH",
      path: "/wallets/policy",
      headers: this.mgmtHeaders(),
      body: { wallet_id: walletId, ...policy },
    })
    return r.policy
  }

  /**
   * Apply a policy blueprint (the parsed contents of examples/policies/*.json).
   * Only the blueprint's `policy` block is sent.
   */
  async applyBlueprint(walletId: string, blueprint: PolicyBlueprint): Promise<Policy> {
    if (!blueprint?.policy) throw new Error("Blueprint has no `policy` block")
    return this.updatePolicy(walletId, blueprint.policy)
  }

  /**
   * Owner-only: deactivate an agent's API key (default) so it fails auth
   * immediately — use for key rotation. Pass `active = true` to re-enable.
   */
  async setAgentActive(walletId: string, agentId: string, active = false): Promise<{ id: string; name: string; apiKeyPrefix: string; isActive: boolean }> {
    const r = await request<Record<string, unknown>>({
      baseUrl: this.baseUrl,
      fetch: this.fetch,
      method: "POST",
      path: "/agents/deactivate",
      headers: this.mgmtHeaders(),
      body: { wallet_id: walletId, agent_id: agentId, active },
    })
    return {
      id: r.id as string,
      name: r.name as string,
      apiKeyPrefix: r.api_key_prefix as string,
      isActive: r.is_active as boolean,
    }
  }

  /** Unified audit feed for a wallet (spend decisions, token usage, secret access). */
  async getAuditEvents(
    walletId: string,
    opts: { type?: "authorization" | "token" | "injection"; limit?: number; before?: string } = {},
  ): Promise<AuditEventsPage> {
    const r = await request<{ events: AuditEventsPage["events"]; next_before: string | null }>({
      baseUrl: this.baseUrl,
      fetch: this.fetch,
      method: "GET",
      path: "/audit-events",
      headers: this.mgmtHeaders(),
      query: { wallet_id: walletId, type: opts.type, limit: opts.limit?.toString(), before: opts.before },
    })
    return { events: r.events, nextBefore: r.next_before }
  }

  /** One UTC-day rollup: spend, decision counts, token cost, secret access, costliest tasks. */
  async getDailySummary(walletId: string, date?: string): Promise<DailySummary> {
    const r = await request<Record<string, any>>({
      baseUrl: this.baseUrl,
      fetch: this.fetch,
      method: "GET",
      path: "/reporting/daily-summary",
      headers: this.mgmtHeaders(),
      query: { wallet_id: walletId, date },
    })
    return {
      date: r.date,
      spendUsd: r.spend_usd,
      decisions: r.decisions,
      tokenCostUsd: r.token_cost_usd,
      tokensIn: r.tokens_in,
      tokensOut: r.tokens_out,
      secretAccesses: r.secret_accesses,
      mostExpensiveTasks: (r.most_expensive_tasks ?? []).map((t: any) => ({ taskLabel: t.task_label, costUsd: t.cost_usd })),
    }
  }

  /** Owner-only: revoke an outstanding execution token before its TTL elapses. */
  async revokeExecutionToken(walletId: string, jti: string): Promise<void> {
    await request<void>({
      baseUrl: this.baseUrl,
      fetch: this.fetch,
      method: "POST",
      path: "/exec/revoke",
      headers: this.mgmtHeaders(),
      body: { wallet_id: walletId, jti },
    })
  }
}
