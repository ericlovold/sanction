import { DEFAULT_BASE_URL, request } from "./http"
import type {
  ClientOptions,
  CreateWalletInput,
  CreatedAgent,
  CreatedWallet,
  Fetch,
  Policy,
  PolicyBlueprint,
  PolicyInput,
  RegisterAgentInput,
} from "./types"

// The policy endpoint speaks snake_case dollars (lib/policy.ts). The SDK speaks
// camelCase; these two maps are the single translation point, so a rename on
// either side is caught here rather than silently dropping fields on the wire.
const POLICY_TO_WIRE: Record<keyof PolicyInput, string> = {
  dailyTokenBudgetUsd: "daily_token_budget_usd",
  dailySpendBudgetUsd: "daily_spend_budget_usd",
  monthlySpendBudgetUsd: "monthly_spend_budget_usd",
  subtreeDailyCapUsd: "subtree_daily_cap_usd",
  perTransactionMaxUsd: "per_transaction_max_usd",
  autoApproveUnderUsd: "auto_approve_under_usd",
  escalateOverUsd: "escalate_over_usd",
  allowedCategories: "allowed_categories",
  blockedCategories: "blocked_categories",
  allowedTools: "allowed_tools",
  blockedTools: "blocked_tools",
  escalateTools: "escalate_tools",
  escalationTimeoutMins: "escalation_timeout_mins",
  escalationTimeoutAction: "escalation_timeout_action",
}

/** camelCase PolicyInput -> the API's snake_case body (only defined fields). */
export function policyToWire(input: PolicyInput): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, wire] of Object.entries(POLICY_TO_WIRE)) {
    const v = (input as Record<string, unknown>)[key]
    if (v !== undefined) out[wire] = v
  }
  return out
}

/** The API's snake_case dollar policy body, as returned by GET/PATCH /wallets/policy. */
interface PolicyWire {
  daily_token_budget_usd: number
  daily_spend_budget_usd: number
  monthly_spend_budget_usd: number | null
  subtree_daily_cap_usd: number | null
  per_transaction_max_usd: number
  auto_approve_under_usd: number
  escalate_over_usd: number
  allowed_categories: string[]
  blocked_categories: string[]
  allowed_tools: string[]
  blocked_tools: string[]
  escalate_tools: string[]
  escalation_timeout_mins: number
  escalation_timeout_action: "deny" | "approve"
}

/** The API's snake_case dollar policy -> the SDK's camelCase Policy. */
export function policyFromWire(w: PolicyWire): Policy {
  return {
    dailyTokenBudgetUsd: w.daily_token_budget_usd,
    dailySpendBudgetUsd: w.daily_spend_budget_usd,
    monthlySpendBudgetUsd: w.monthly_spend_budget_usd ?? null,
    subtreeDailyCapUsd: w.subtree_daily_cap_usd ?? null,
    perTransactionMaxUsd: w.per_transaction_max_usd,
    autoApproveUnderUsd: w.auto_approve_under_usd,
    escalateOverUsd: w.escalate_over_usd,
    allowedCategories: w.allowed_categories ?? [],
    blockedCategories: w.blocked_categories ?? [],
    allowedTools: w.allowed_tools ?? [],
    blockedTools: w.blocked_tools ?? [],
    escalateTools: w.escalate_tools ?? [],
    escalationTimeoutMins: w.escalation_timeout_mins,
    escalationTimeoutAction: w.escalation_timeout_action,
  }
}

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

  /** Read the wallet's current policy (dollars). */
  async getPolicy(walletId: string): Promise<Policy> {
    const r = await request<{ policy: PolicyWire }>({
      baseUrl: this.baseUrl,
      fetch: this.fetch,
      method: "GET",
      path: "/wallets/policy",
      headers: this.mgmtHeaders(),
      query: { wallet_id: walletId },
    })
    return policyFromWire(r.policy)
  }

  /** Partial-update the wallet's policy (dollars). Omitted fields are unchanged. */
  async updatePolicy(walletId: string, policy: PolicyInput): Promise<Policy> {
    const r = await request<{ policy: PolicyWire }>({
      baseUrl: this.baseUrl,
      fetch: this.fetch,
      method: "PATCH",
      path: "/wallets/policy",
      headers: this.mgmtHeaders(),
      body: { wallet_id: walletId, ...policyToWire(policy) },
    })
    return policyFromWire(r.policy)
  }

  /**
   * Apply a policy blueprint (the parsed contents of a policy JSON file).
   * Only the blueprint's `policy` block is sent.
   */
  async applyBlueprint(walletId: string, blueprint: PolicyBlueprint): Promise<Policy> {
    if (!blueprint?.policy) throw new Error("Blueprint has no `policy` block")
    return this.updatePolicy(walletId, blueprint.policy)
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
