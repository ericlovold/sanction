// The normalized grain every provider connector maps into (UsageFact in
// prisma/schema.prisma), plus the two things every connector shares: the
// idempotency key and the typed failure a pull can end in.

import { createHash } from "node:crypto"

export const HOUR_MS = 3_600_000
export const DAY_MS = 86_400_000

export type CostBasis =
  | "billed" // the provider charged this
  | "included" // usage the plan already covers; a value, not an extra charge
  | "estimated" // tokens x a price table, to be reconciled later

export type FactInput = {
  provider: string
  surface: "ide" | "agent" | "api" | "chat" | "claude_code"
  rawIdentity: string
  // "unattributed" is usage the provider could not tie to any identity.
  identityType: "user" | "service_account" | "api_key" | "unattributed"
  model: string
  sessionRef: string | null
  automationRef: string | null
  headless: boolean
  bucketStart: Date
  bucketEnd: Date
  inputTokens: bigint
  outputTokens: bigint
  cacheReadTokens: bigint
  cacheWriteTokens: bigint
  tokenReportedRequests?: number
  requests: number
  costNanos: bigint
  costBasis: CostBasis
}

export function hourStart(ms: number): number {
  return Math.floor(ms / HOUR_MS) * HOUR_MS
}

/**
 * Identity of one fact row: the connection, the bucket, and every dimension.
 * Two pulls of the same provider data produce the same keys, so a replayed
 * pull can only replace rows, never add to them.
 */
export function factDedupeKey(connectionId: string, f: FactInput): string {
  const identity = [
    connectionId, f.provider, f.surface, f.rawIdentity, f.identityType, f.model,
    f.sessionRef, f.automationRef, f.headless, f.costBasis, f.bucketStart.getTime(), f.bucketEnd.getTime(),
  ]
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex")
}

// Why a pull failed, in terms the connect screen can act on. The message is
// written for the operator and never carries a provider payload or a key.
export type ConnectorErrorKind =
  | "bad_key" // provider rejected the credential
  | "plan_unsupported" // key is valid; the account's plan lacks this API
  | "rate_limited" // still limited after honoring Retry-After
  | "provider_unavailable" // 5xx or network failure
  | "unexpected_response" // response did not match the documented contract
  | "missing_credential" // the vault row is gone

export class ConnectorError extends Error {
  constructor(
    readonly kind: ConnectorErrorKind,
    message: string,
  ) {
    super(message)
    this.name = "ConnectorError"
  }
}

// Failures that will not heal by retrying: the poller stops until a human
// reconnects, instead of sending a dead key to the provider every hour.
export function needsReconnect(kind: string | null | undefined): boolean {
  return kind === "bad_key" || kind === "plan_unsupported" || kind === "missing_credential"
}
