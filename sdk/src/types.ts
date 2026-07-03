// Public SDK types. The SDK speaks camelCase; per-endpoint wire mapping (the API
// uses snake_case bodies) is handled internally.

export type Fetch = typeof globalThis.fetch

export interface ClientOptions {
  /** Base URL of the Sanction API, e.g. https://getsanction.com/api/v1 */
  baseUrl?: string
  /** Inject a fetch implementation (defaults to global fetch). Useful for tests. */
  fetch?: Fetch
}

/** Options for the agent data-plane client, incl. the local-first fallback. */
export interface AgentClientOptions extends ClientOptions {
  /**
   * Policy to evaluate against locally when Sanction is unreachable. Mirrors the
   * server decision order for spend (category → per-txn → daily budget → floor →
   * escalate). Amounts are dollars, like PolicyInput.
   */
  localPolicy?: PolicyInput
  /** With no localPolicy and Sanction unreachable, deny (true, default) or allow (false). */
  failClosed?: boolean
  /** Abort a slow /authorize after this many ms and decide locally. Default 3000. */
  networkTimeoutMs?: number
  /** Never touch the network — always decide locally against localPolicy. */
  offline?: boolean
}

// ---- Authorization (data plane: pxy_ key) ----

export type SpendAction = "purchase" | "subscribe" | "transfer"
export type DecisionStatus = "approved" | "denied" | "escalated" | "pending"

// Stable machine-readable decision codes (mirrors the API's DecisionCode). The
// `(string & {})` arm keeps forward compatibility: a code the server adds later
// still types as a string rather than breaking the build.
export type DecisionCode =
  | "ESCALATION_REQUIRED"
  | "ESCALATION_TIMED_OUT"
  | "NO_POLICY"
  | "CATEGORY_BLOCKED"
  | "CATEGORY_NOT_ALLOWED"
  | "RESOURCE_BLOCKED"
  | "RESOURCE_NOT_ALLOWED"
  | "AMOUNT_MISMATCH"
  | "PER_TXN_LIMIT"
  | "DAILY_BUDGET_EXCEEDED"
  | "SUBTREE_CAP_EXCEEDED"
  | "EXEC_BUDGET_EXCEEDED"
  | "GRANT_NOT_FOUND"
  | "GRANT_ALREADY_USED"
  | "GRANT_EXPIRED"
  | "GRANT_MISMATCH"
  | "GRANT_UNSUPPORTED"
  | "POLICY_DENIED"
  | (string & {})

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
  /** True when the SDK decided this locally because Sanction was unreachable. */
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

/**
 * Partial policy update — omitted fields are unchanged. All monetary fields are
 * in **dollars** (the API stores cents internally). Set `subtreeDailyCapUsd` to
 * `null` to remove a subtree cap.
 */
export interface PolicyInput {
  dailyTokenBudgetUsd?: number
  dailySpendBudgetUsd?: number
  /** Optional monthly spend cap. Set null to remove it. */
  monthlySpendBudgetUsd?: number | null
  subtreeDailyCapUsd?: number | null
  perTransactionMaxUsd?: number
  autoApproveUnderUsd?: number
  escalateOverUsd?: number
  allowedCategories?: string[]
  blockedCategories?: string[]
  allowedTools?: string[]
  blockedTools?: string[]
  escalateTools?: string[]
  /** Minutes an escalation waits before the timeout action fires. 0 = never. */
  escalationTimeoutMins?: number
  escalationTimeoutAction?: "deny" | "approve"
}

/** A wallet's full policy, in dollars. Returned by getPolicy / updatePolicy. */
export interface Policy {
  dailyTokenBudgetUsd: number
  dailySpendBudgetUsd: number
  monthlySpendBudgetUsd: number | null
  subtreeDailyCapUsd: number | null
  perTransactionMaxUsd: number
  autoApproveUnderUsd: number
  escalateOverUsd: number
  allowedCategories: string[]
  blockedCategories: string[]
  allowedTools: string[]
  blockedTools: string[]
  escalateTools: string[]
  escalationTimeoutMins: number
  escalationTimeoutAction: "deny" | "approve"
}

/** Shape of a policy blueprint file — only the `policy` block is sent to the API. */
export interface PolicyBlueprint {
  policy: PolicyInput
  [key: string]: unknown
}
