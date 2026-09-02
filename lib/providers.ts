// Provider connections — the one place the dashboard and gateway agree on what
// a "provider" is: identity, model attribution, chart color, vault label, and
// which auth header the upstream expects.

export type ProviderId = "anthropic" | "openai" | "gemini" | "perplexity"

// Vault rows that only the server may read. `allowedAgentIds` empty means
// "every agent in the wallet" (prisma/schema.prisma), so a gateway-only key
// must carry an allow-list no real agent id can ever match — the same pattern
// the MCP broker uses for `mcp:<name>` rows. Belt: the sentinel. Braces:
// `isReservedVaultLabel`, which /exec refuses regardless of allow-list or
// clearance, so a hand-edited row can never open the key to an agent either.
export const GATEWAY_ONLY_SENTINEL = "gateway-internal-only"
export const RESERVED_LABEL_PREFIXES = ["provider:", "mcp:"] as const
export function isReservedVaultLabel(label: string): boolean {
  return RESERVED_LABEL_PREFIXES.some((p) => label.startsWith(p))
}

export type ProviderInfo = {
  id: ProviderId
  name: string
  // Categorical palette validated with the dataviz six-checks (light surface);
  // the tritan worst-pair is covered by gaps + direct labels wherever rendered.
  color: string
  // The reserved vault label a connected key is stored under.
  vaultLabel: string
  // Example model tag shown in config snippets.
  exampleModel: string
  // Native API path an SDK would call through the gateway.
  examplePath: string
}

export const PROVIDERS: ProviderInfo[] = [
  { id: "anthropic", name: "Anthropic", color: "#169065", vaultLabel: "provider:anthropic", exampleModel: "claude-sonnet-4-6", examplePath: "v1/messages" },
  { id: "openai", name: "OpenAI", color: "#2e69b2", vaultLabel: "provider:openai", exampleModel: "gpt-4o", examplePath: "v1/chat/completions" },
  { id: "gemini", name: "Google", color: "#b88513", vaultLabel: "provider:gemini", exampleModel: "gemini-2.5-pro", examplePath: "v1beta/models/gemini-2.5-pro:generateContent" },
  { id: "perplexity", name: "Perplexity", color: "#953c41", vaultLabel: "provider:perplexity", exampleModel: "sonar-pro", examplePath: "chat/completions" },
]

export const OTHER_COLOR = "#953c41"

/** Attribute a model tag to a provider display name (donuts, spend rollups). */
export function providerNameOf(model: string): string {
  const m = model.toLowerCase()
  if (m.includes("claude")) return "Anthropic"
  if (m.startsWith("gpt") || m.startsWith("o1") || m.startsWith("o3") || m.includes("openai")) return "OpenAI"
  if (m.includes("gemini")) return "Google"
  if (m.includes("sonar")) return "Perplexity"
  return "Other"
}

/**
 * The auth header a provider's API expects. Used by the gateway when it
 * injects a vaulted provider key server-side (only when the caller sent no
 * provider auth of its own).
 */
export function providerAuthHeader(id: ProviderId, key: string): { name: string; value: string } {
  switch (id) {
    case "anthropic":
      return { name: "x-api-key", value: key }
    case "gemini":
      return { name: "x-goog-api-key", value: key }
    case "openai":
    case "perplexity":
      return { name: "authorization", value: `Bearer ${key}` }
  }
}

/** True when the inbound request already carries provider auth of any style. */
export function hasProviderAuth(headers: Headers): boolean {
  return !!(headers.get("authorization") || headers.get("x-api-key") || headers.get("x-goog-api-key"))
}
