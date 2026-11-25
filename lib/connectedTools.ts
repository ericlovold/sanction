// Which of a wallet's AI tools are actually connected, folded from every place
// a connection can live: a stored provider key (api_key), a usage connection
// (admin_usage), client reports (local_collector) and uploaded billing
// exports (billing_export). Pure over its inputs so the rules below unit-test
// without a database.
//
// Rules:
// 1. Connected only. A tool appears when one of its BUILT methods has a live
//    connection or recorded usage this month. Nothing renders as "Not
//    connected": unconnected tools live in the picker, never on the dashboard.
// 2. Unknown is not empty. When a read fails and nothing else was found, the
//    answer is "unavailable", never "no tools connected".
// 3. No double counting. A tool's headline figure comes from ONE source, the
//    most authoritative it has: provider-billed (admin_usage) over the
//    estimate Sanction recorded (api_key, priced from tokens). Any other figure is a labeled second line and
//    is never added to the headline, because a gateway call made with a key
//    from the same organization is already inside the billed total.
// 4. No false zeros. A stored key with no calls says so in words, not "$0.00".

import { TOOL_CATALOG, type ConnectionBucket, type Tool, type ToolId } from "./toolCatalog"
import type { ProviderId } from "./providers"
import type { UsageProviderId } from "./connectors/registry"
import type { UsageSource } from "./usageObservation"
import type { BillingProduct } from "./cursorBilling"

// The admin connection's health, as lib/connectors/spendView.ts computes it.
export type AdminHealth = "ok" | "waiting" | "stale" | "failing" | "reconnect"

// Every input may be null: that read failed, so its connections are unknown.
export type ConnectionSignals = {
  providerKeys: ProviderId[] | null
  adminConnections: { provider: UsageProviderId; health: AdminHealth }[] | null
  // Sources with at least one delivery, and whether one arrived recently.
  collectorDeliveries: { source: UsageSource; recent: boolean }[] | null
  billingExports: BillingProduct[] | null
  // Model spend Sanction recorded this month (gateway calls and submitted
  // token logs), by provider. A provider present at $0 has records.
  recordedUsd: Map<ProviderId, number> | null
  // Provider-billed spend this month from admin connections, in USD.
  billedUsd: Map<UsageProviderId, number> | null
}

export type MethodState = "ok" | "waiting" | "attention"

export type ConnectedMethod = {
  bucket: ConnectionBucket
  label: string
  href: string | undefined
  state: MethodState
  detail: string
}

export type SpendSource = "billed" | "recorded"

export type ConnectedTool = {
  id: ToolId
  name: string
  brand: string
  methods: ConnectedMethod[]
  // One figure, from one source. Null when no connected method has one.
  headline: { usd: number; source: SpendSource } | null
  // Other figures, labeled, never summed into the headline.
  alsoRecordedUsd: number | null
}

export type ConnectedToolsView =
  | { kind: "unavailable" }
  | { kind: "empty"; addable: Tool[] }
  | { kind: "tools"; tools: ConnectedTool[]; addable: Tool[]; partial: boolean }

const ADMIN_STATE: Record<AdminHealth, { state: MethodState; detail: string }> = {
  ok: { state: "ok", detail: "Reading the provider's usage records" },
  waiting: { state: "waiting", detail: "Waiting for the first pull" },
  stale: { state: "attention", detail: "No fresh pull in over twice the usual delay" },
  failing: { state: "attention", detail: "Pulls are failing" },
  reconnect: { state: "attention", detail: "The provider refused the key. Reconnect it." },
}

function apiKeyMethod(stored: boolean, recorded: number | undefined): Pick<ConnectedMethod, "state" | "detail"> {
  if (stored && recorded === undefined) {
    return { state: "waiting", detail: "Key stored. No calls through Sanction yet this month." }
  }
  if (stored) return { state: "ok", detail: "Key stored. Calls through Sanction are metered." }
  return { state: "ok", detail: "Usage your agents reported to Sanction" }
}

/** Fold the signals into the tools to show, in catalog order. */
export function connectedTools(signals: ConnectionSignals, catalog: Tool[] = TOOL_CATALOG): ConnectedToolsView {
  const keys = new Set(signals.providerKeys ?? [])
  const admin = new Map((signals.adminConnections ?? []).map((c) => [c.provider, c.health]))
  const collector = new Map((signals.collectorDeliveries ?? []).map((d) => [d.source, d.recent]))
  const exports = new Set(signals.billingExports ?? [])
  const recorded = signals.recordedUsd ?? new Map<ProviderId, number>()
  const billed = signals.billedUsd ?? new Map<UsageProviderId, number>()
  const partial = Object.values(signals).some((v) => v === null)

  const tools: ConnectedTool[] = []
  const addable: Tool[] = []
  for (const tool of catalog) {
    const methods: ConnectedMethod[] = []
    let billedUsd: number | null = null
    let recordedUsd: number | null = null
    for (const m of tool.methods) {
      if (!m.built) continue
      const base = { bucket: m.bucket, label: m.label, href: m.href }
      if (m.providerId) {
        const stored = keys.has(m.providerId)
        const spend = recorded.get(m.providerId)
        if (!stored && spend === undefined) continue
        methods.push({ ...base, ...apiKeyMethod(stored, spend) })
        if (spend !== undefined) recordedUsd = (recordedUsd ?? 0) + spend
      } else if (m.usageProviderId) {
        const health = admin.get(m.usageProviderId)
        if (!health) continue
        methods.push({ ...base, ...ADMIN_STATE[health] })
        const b = billed.get(m.usageProviderId)
        if (b !== undefined) billedUsd = (billedUsd ?? 0) + b
      } else if (m.usageSource) {
        if (!collector.has(m.usageSource)) continue
        const recent = collector.get(m.usageSource)
        methods.push({ ...base, state: recent ? "ok" : "waiting", detail: recent ? "Reports arriving" : "No report in the last 15 minutes" })
      } else if (m.billingProduct) {
        if (!exports.has(m.billingProduct)) continue
        methods.push({ ...base, state: "ok", detail: "Billing export imported" })
      }
    }
    if (!methods.length) {
      if (tool.methods.some((m) => m.built)) addable.push(tool)
      continue
    }
    const headline =
      billedUsd !== null ? { usd: billedUsd, source: "billed" as const }
      : recordedUsd !== null ? { usd: recordedUsd, source: "recorded" as const }
      : null
    tools.push({
      id: tool.id,
      name: tool.name,
      brand: tool.brand,
      methods,
      headline,
      alsoRecordedUsd: headline?.source === "billed" ? recordedUsd : null,
    })
  }

  if (tools.length) return { kind: "tools", tools, addable, partial }
  return partial ? { kind: "unavailable" } : { kind: "empty", addable }
}
