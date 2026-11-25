// "Select the tools you use": what a person can pick, and every way Sanction
// can connect each pick. One entry per tool as people name their stack
// (Claude, Codex, Cursor), not per vendor API. Each method states, before any
// key is pasted, what it shows and what it cannot.
//
// The four buckets differ in kind, not degree:
// - admin_usage: an org admin or analytics key reads the provider's OWN usage
//   and cost records, with history. Read-only.
// - api_key: a normal API key cannot read usage or billing at any provider in
//   this catalog. Sanction holds the key, apps call through the gateway, and
//   only those calls are metered, from the moment they start. It is the one
//   method that can stop spend.
// - local_collector: the tool reports sessions and tokens from each machine.
// - billing_export: the person uploads the provider's billing export.
//
// The fold in lib/connectedTools.ts reads this list to decide which tools a
// wallet has actually connected. Nothing here is shown on the dashboard unless
// that fold finds a live connection or recorded usage behind it.

import type { ProviderId } from "./providers"
import type { UsageProviderId } from "./connectors/registry"
import type { UsageSource } from "./usageObservation"
import type { BillingProduct } from "./cursorBilling"

export type ConnectionBucket = "admin_usage" | "api_key" | "local_collector" | "billing_export"

export type ToolId = "claude" | "openai" | "codex" | "cursor" | "gemini" | "perplexity" | "grok" | "mistral"

export type ConnectionMethod = {
  bucket: ConnectionBucket
  label: string
  // Built and usable today. Unbuilt methods are listed so the gap is stated,
  // never offered as a button.
  built: boolean
  shows: string
  cannotShow: string
  // History the first connection brings in. 0 means from now on.
  historyDays: number
  // Only the gateway can refuse a call. Every other method observes.
  canEnforce: boolean
  // Where the connection is made. Absent for unbuilt methods.
  href?: string
  // Exactly one of these links a method to the rows that prove it connected.
  providerId?: ProviderId
  usageProviderId?: UsageProviderId
  usageSource?: UsageSource
  billingProduct?: BillingProduct
}

export type Tool = {
  id: ToolId
  name: string
  // BrandIcon id. Brands without a mark render an initial.
  brand: string
  methods: ConnectionMethod[]
}

// A plain key's limits, said the same way everywhere it appears.
const API_KEY_SHOWS = "Calls your apps send through Sanction, metered and held to budgets"
const API_KEY_CANNOT = "Usage outside Sanction or before you connected. A normal API key cannot read the provider's usage or billing."

function apiKey(providerId: ProviderId, name: string): ConnectionMethod {
  return {
    bucket: "api_key",
    label: `${name} API key`,
    built: true,
    shows: API_KEY_SHOWS,
    cannotShow: API_KEY_CANNOT,
    historyDays: 0,
    canEnforce: true,
    href: "/dashboard/providers",
    providerId,
  }
}

function apiKeyNotBuilt(name: string, why: string): ConnectionMethod {
  return {
    bucket: "api_key",
    label: `${name} API key`,
    built: false,
    shows: API_KEY_SHOWS,
    cannotShow: `${API_KEY_CANNOT} ${why}`,
    historyDays: 0,
    canEnforce: true,
  }
}

export const TOOL_CATALOG: Tool[] = [
  {
    id: "claude",
    name: "Claude",
    brand: "anthropic",
    methods: [
      {
        bucket: "admin_usage",
        label: "Claude Console organization (Admin key)",
        built: true,
        shows: "Spend per person, service account and API key, from Anthropic's own records",
        cannotShow: "Claude Team, Enterprise seats and Pro or Max subscriptions",
        historyDays: 30,
        canEnforce: false,
        href: "/dashboard/ai-spend",
        usageProviderId: "anthropic",
      },
      apiKey("anthropic", "Claude"),
      {
        bucket: "local_collector",
        label: "Claude Code reporting",
        built: true,
        shows: "Claude Code sessions, tokens and cost estimates from each machine",
        cannotShow: "Machines that do not send reports, and subscription limits",
        historyDays: 0,
        canEnforce: false,
        href: "/dashboard/connect?source=claude-code",
        usageSource: "claude-code",
      },
    ],
  },
  {
    id: "openai",
    name: "OpenAI API",
    brand: "openai",
    methods: [
      {
        bucket: "admin_usage",
        label: "OpenAI organization (Admin key)",
        built: true,
        shows: "What OpenAI billed per day, and tokens per person, project and API key",
        cannotShow: "ChatGPT seats, and exact cost per model or hour",
        historyDays: 30,
        canEnforce: false,
        href: "/dashboard/ai-spend",
        usageProviderId: "openai",
      },
      apiKey("openai", "OpenAI"),
    ],
  },
  {
    id: "codex",
    name: "Codex",
    brand: "codex",
    methods: [
      {
        bucket: "local_collector",
        label: "Codex reporting",
        built: true,
        shows: "Local Codex sessions and tokens from each machine",
        cannotShow: "Cost, and ChatGPT plan limits",
        historyDays: 0,
        canEnforce: false,
        href: "/dashboard/connect?source=codex",
        usageSource: "codex",
      },
    ],
  },
  {
    id: "cursor",
    name: "Cursor",
    brand: "cursor",
    methods: [
      {
        bucket: "admin_usage",
        label: "Cursor team (Admin key)",
        built: true,
        shows: "Spend per person, model and hour, including background agents",
        cannotShow: "Individual (non-team) Cursor accounts",
        historyDays: 30,
        canEnforce: false,
        href: "/dashboard/ai-spend",
        usageProviderId: "cursor",
      },
      {
        bucket: "billing_export",
        label: "Cursor billing export",
        built: true,
        shows: "Every billed item in the export you upload",
        cannotShow: "Anything after your last upload",
        historyDays: 0,
        canEnforce: false,
        href: "/dashboard/usage/cursor",
        billingProduct: "cursor",
      },
    ],
  },
  {
    id: "gemini",
    name: "Gemini",
    brand: "gemini",
    methods: [
      apiKey("gemini", "Gemini"),
      {
        bucket: "admin_usage",
        label: "Google Cloud billing export",
        built: false,
        shows: "Billed Gemini spend per Google Cloud project, from its BigQuery billing export",
        cannotShow: "Per-person spend. An AI Studio key cannot read billing at all.",
        historyDays: 0,
        canEnforce: false,
      },
    ],
  },
  {
    id: "perplexity",
    name: "Perplexity",
    brand: "perplexity",
    // A Perplexity key can be stored, but the gateway refuses Perplexity
    // generation (lib/gatewayRequestBudget.ts): search adds input that cannot
    // be reserved ahead of time. Until that changes the key records nothing,
    // so it is a stated gap, not a dashboard card.
    methods: [apiKeyNotBuilt("Perplexity", "The gateway refuses Perplexity calls today because search adds input it cannot budget ahead of time.")],
  },
  {
    id: "grok",
    name: "Grok",
    brand: "grok",
    methods: [
      {
        bucket: "admin_usage",
        label: "xAI team (Management key)",
        built: false,
        shows: "Spend per API key and model from xAI's own billing records",
        cannotShow: "Grok in the X app and SuperGrok subscriptions",
        historyDays: 0,
        canEnforce: false,
      },
      apiKeyNotBuilt("Grok", "The gateway does not route xAI yet."),
      {
        bucket: "billing_export",
        label: "Grok Bot billing export",
        built: true,
        shows: "Every billed item in the export you upload",
        cannotShow: "Anything after your last upload",
        historyDays: 0,
        canEnforce: false,
        href: "/dashboard/usage/grok-bot",
        billingProduct: "grok-bot",
      },
    ],
  },
  {
    id: "mistral",
    name: "Mistral",
    brand: "mistral",
    methods: [apiKeyNotBuilt("Mistral", "The gateway does not route Mistral yet.")],
  },
]

export function toolById(id: string): Tool | undefined {
  return TOOL_CATALOG.find((t) => t.id === id)
}

/** The picked tools from a `?tool=` query, in catalog order, unknown ids dropped. */
export function pickedTools(param: string | string[] | undefined): Tool[] {
  const ids = new Set(Array.isArray(param) ? param : param ? [param] : [])
  return TOOL_CATALOG.filter((t) => ids.has(t.id))
}

/** The tool a gateway provider key belongs to. */
export function toolForProvider(providerId: ProviderId): Tool | undefined {
  return TOOL_CATALOG.find((t) => t.methods.some((m) => m.providerId === providerId))
}
