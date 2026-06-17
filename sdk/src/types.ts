// Public SDK types. The SDK speaks camelCase; per-endpoint wire mapping
// (some endpoints use snake_case bodies) is handled internally.

export type Fetch = typeof globalThis.fetch

export interface ClientOptions {
  /** Base URL of the Sanction API, e.g. https://proxy-ai-three.vercel.app/api/v1 */
  baseUrl?: string
  /** Inject a fetch implementation (defaults to global fetch). Useful for tests. */
  fetch?: Fetch
}

/** Options for the agent (data-plane) client, including local-first resilience. */
export interface AgentClientOptions extends ClientOptions {
  /**
   * Local-first resilience: a copy of the wallet's policy the SDK evaluates
   * against when Sanction is unreachable or slow. The agent key can't read the
   * policy (it's management-plane), so the owner supplies it here — e.g. the
   * same `policy` block applied via the admin client / a blueprint.
   */
  localPolicy?: PolicyInput
  /**
   * When Sanction is unreachable AND no local policy is available to decide,
   * deny (true, default) or allow-and-log (false). A governance layer that
   * fails open is worthless, so this defaults to fail-closed.
   */
  failClosed?: boolean
  /** Abort the network authorize() after this many ms and fall back to local. Default 3000. */
  networkTimeoutMs?: number
  /** Skip the network entirely and always decide locally (air-gapped / testing). */
  offline?: boolean
}

// ---- Authorization (data plane: pxy_ key) ----

export type SpendAction = "purchase" | "subscribe" | "transfer"
export type DecisionStatus = "approved" | "denied" | "escalated" | "pending"
export type DecisionCode =
  | "ESCALATION_REQUIRED"
  | "NO_POLICY"
  | "CATEGORY_BLOCKED"
  | "PER_TXN_LIMIT"
  | "DAILY_BUDGET_EXCEEDED"
  | "POLICY_DENIED"

export interface AuthorizeInput {
  action: SpendAction
  amountUsd: number
  merchant: string
  category: string
  description?: string
  /** Dedupes retries server-side; the same key returns the original decision. */
  idempotencyKey?: string
}

export interface Decision {
  authorized: boolean
  status: DecisionStatus
  requestId: string
  reason?: string
  code?: DecisionCode
  remediation?: string
  agent: string
  amountUsd: number
  merchant: string
  /** True when this decision was made locally (Sanction was unreachable). */
  decidedLocally?: boolean
}

export interface LogTokensInput {
  model: string
  tokensIn: number
  tokensOut: number
  costUsd: number
  task?: string
}

export interface ExecTokenInput {
  /** Credential labels this execution needs. */
  scope: string[]
  budgetUsd: number
  ttlSeconds?: number
  containerId?: string
}

export interface ExecToken {
  jwt: string
  jti: string
  expiresAt: string
  clearance: number
  scope: string[]
  budgetUsd: number
  ttlSeconds: number
}

export interface InjectedCredential {
  label: string
  type: string
  value: string
  injectedAt: string
  expiresAt: string
}

export interface WalletStats {
  today: { tokenCostUsd: number; tokensIn: number; tokensOut: number; spendUsd: number }
  month: { tokenCostUsd: number; spendUsd: number }
  pendingApprovals: number
}

// ---- Management plane (sk_ key) ----

export interface CreateWalletInput {
  name: string
  ownerEmail: string
}

export interface CreatedWallet {
  id: string
  name: string
  ownerEmail: string
  /** Shown once. Store it — gates every management-plane call. */
  managementKey: string
  managementKeyPrefix: string
}

export interface RegisterAgentInput {
  walletId: string
  name: string
}

export interface CreatedAgent {
  id: string
  name: string
  /** Shown once. The agent's data-plane key (pxy_). */
  apiKey: string
  apiKeyPrefix: string
  walletId: string
}

/** All amounts are integer cents. Partial — omitted fields are unchanged on update. */
export interface PolicyInput {
  dailyTokenBudgetUsd?: number
  dailySpendBudgetUsd?: number
  perTransactionMaxUsd?: number
  autoApproveUnderUsd?: number
  escalateOverUsd?: number
  allowedCategories?: string[]
  blockedCategories?: string[]
}

export interface Policy extends Required<Omit<PolicyInput, never>> {
  updatedAt: string
}

/** Shape of examples/policies/*.json — only the `policy` block is sent to the API. */
export interface PolicyBlueprint {
  policy: PolicyInput
  [key: string]: unknown
}
