// What a usage connector is, in one place: the page, the sync and the vault
// all read the same record. One entry per connector that is actually built.

export type UsageProviderId = "cursor"

export type UsageProvider = {
  id: UsageProviderId
  name: string
  // One color per provider, the same everywhere it is drawn.
  color: string
  authKind: "admin_api_key"
  // How late the provider's own numbers run. Shown next to every figure.
  freshness: string
  // A pull is "stale" when none has succeeded in twice this long.
  expectedFreshnessMs: number
  // How much history the first pull reads.
  backfillDays: number
  // Re-read on every pull, because provider data settles after the fact.
  overlapHours: number
  keyLocation: string
  keyHelpUrl: string
  rotationUrl: string
  keyHint: string
  // What this connection can and cannot show, stated before the key is pasted.
  gives: string[]
  lacks: string[]
  canEnforce: boolean
}

export const USAGE_PROVIDERS: UsageProvider[] = [
  {
    id: "cursor",
    name: "Cursor",
    color: "#7c5cd6",
    authKind: "admin_api_key",
    freshness: "Hourly. Cursor aggregates usage by the hour, and Sanction pulls once an hour.",
    expectedFreshnessMs: 3_600_000,
    backfillDays: 30,
    overlapHours: 48,
    keyLocation: "cursor.com/dashboard, then API Keys, then New API Key",
    keyHelpUrl: "https://cursor.com/docs/api",
    rotationUrl: "https://cursor.com/dashboard",
    keyHint: "A Cursor API key starts with crsr_.",
    gives: ["Spend per person, model and hour", "Background agents, automations and single conversations", "Billed and plan-included usage, separately"],
    lacks: ["Individual (non-team) Cursor accounts", "Lines of code and other output measures (not pulled yet)"],
    canEnforce: false,
  },
]

export function usageProvider(id: string): UsageProvider | undefined {
  return USAGE_PROVIDERS.find((p) => p.id === id)
}

// Reserved vault label for a connection's credential. The label is part of
// the ciphertext's authenticated data, so a blob cannot be replayed under a
// different connection. `usage:` is refused by /exec and the vault API
// (lib/providers.ts RESERVED_LABEL_PREFIXES): no agent can ever be handed an
// admin key to someone's AI account.
export function usageVaultLabel(provider: string, connectionId: string): string {
  return `usage:${provider}:${connectionId}`
}

export const KEY_AGE_WARNING_DAYS = 90
