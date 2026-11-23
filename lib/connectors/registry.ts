// What a usage connector is, in one place: the page, the sync and the vault
// all read the same record. One entry per connector that is actually built.

export type UsageProviderId = "cursor" | "anthropic" | "openai"

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
  // Ways a team may use this tool, when one key does not cover them all. The
  // connect card lists each with what it needs, so nobody pastes a key that
  // cannot work for their plan.
  routes?: { label: string; available: boolean; note: string }[]
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
  {
    id: "anthropic",
    name: "Claude",
    // The same green Anthropic has on the gateway Providers page.
    color: "#169065",
    authKind: "admin_api_key",
    freshness: "Usually within 4 hours, up to 24. Anthropic can revise a month until about 7 days after it ends.",
    expectedFreshnessMs: 4 * 3_600_000,
    backfillDays: 30,
    // Re-read eight days on every pull so late revisions land.
    overlapHours: 8 * 24,
    keyLocation: "the Claude Console at platform.claude.com, under Admin keys",
    keyHelpUrl: "https://platform.claude.com/docs/en/manage-claude/admin-api-keys",
    rotationUrl: "https://platform.claude.com/docs/en/manage-claude/admin-api-keys",
    keyHint: "Use an Admin API key from a Claude Console organization, not a regular API key.",
    gives: ["Spend per person, service account or API key, by model and hour", "Claude Code, API and other products, separately", "What Anthropic charged after discounts"],
    lacks: ["Single conversations (Anthropic reports no session for API usage)", "List price next to charged price (not pulled yet)"],
    canEnforce: false,
    routes: [
      { label: "Claude API (Console organization)", available: true, note: "Admin API key. This is what the form below connects." },
      { label: "Claude Enterprise", available: false, note: "Needs an analytics key created by your primary owner. Not built yet." },
      { label: "Claude Team", available: false, note: "Anthropic offers no API for Team plans, only a spend report export. Upload is not built yet." },
      { label: "Claude Code on Pro or Max", available: false, note: "Subscription sign-ins are not in Anthropic's reporting. See Usage for the Claude Code reporting Sanction already collects." },
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    // The same blue OpenAI has on the gateway Providers page.
    color: "#2e69b2",
    authKind: "admin_api_key",
    freshness: "Tokens by the hour, cost by the day. OpenAI does not publish how far behind its reporting runs.",
    expectedFreshnessMs: 3_600_000,
    backfillDays: 30,
    overlapHours: 72,
    keyLocation: "platform.openai.com/settings/organization/admin-keys",
    keyHelpUrl: "https://developers.openai.com/cookbook/examples/completions_usage_api",
    rotationUrl: "https://platform.openai.com/settings/organization/admin-keys",
    keyHint: "Use an Admin key from the organization settings, not a regular API key.",
    gives: ["What OpenAI billed per person or API key, per day", "Tokens per person, model and hour", "Today's spend as an estimate, until OpenAI prices the day"],
    lacks: [
      "Exact cost per model or per hour: OpenAI bills by the day with no model, so that split is by token share",
      "Names and emails: OpenAI reports user ids",
      "ChatGPT Team, Business and Enterprise seats",
    ],
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
