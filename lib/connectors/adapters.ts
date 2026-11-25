// One adapter per provider: the two things the sync and the connect screen
// need from a connector, behind one shape. Adding a provider means adding an
// entry here and in registry.ts; nothing in sync.ts changes.

import { ANTHROPIC_COST_PATH, ANTHROPIC_USAGE_PATH, fetchAnthropicUsageAndCost, normalizeAnthropicRows } from "./anthropic"
import { COPILOT_AI_CREDIT_PATH, COPILOT_USERS_REPORT_PATH, fetchCopilotDays, normalizeCopilotDays, probeCopilot, utcDayStart } from "./copilot"
import { CURSOR_USAGE_EVENTS_PATH, fetchCursorUsageEvents, normalizeCursorEvents } from "./cursor"
import { DAY_MS, HOUR_MS, hourStart, type ConnectorCredential, type FactInput } from "./facts"
import { OPENAI_COSTS_PATH, OPENAI_USAGE_PATH, fetchOpenAiUsageAndCosts, normalizeOpenAiBuckets } from "./openai"
import type { FetchDeps } from "./pace"
import type { UsageProviderId } from "./registry"

export type Pulled = {
  facts: FactInput[]
  // Where the returned facts actually begin. Usually the asked-for start; a
  // provider that only prices whole days reaches back to midnight. The sync
  // replaces stored facts from here, so nothing is left half-replaced.
  fromMs: number
  httpCalls: number
  // The provider's own statement of how current the data is, when it makes one.
  refreshedAt: Date | null
}

export type ConnectorAdapter = {
  // What the credential is sent to, for the credential-use record.
  endpoint: string
  /** Every fact for hour-aligned `startMs` up to `endMs`. Throws ConnectorError. */
  pull(credential: ConnectorCredential, window: { startMs: number; endMs: number }, deps?: FetchDeps): Promise<Pulled>
  /** Cheapest call that proves the credential works. Throws ConnectorError; stores nothing. */
  probe(credential: ConnectorCredential, now: Date, deps?: FetchDeps): Promise<void>
}

const ADAPTERS: Record<UsageProviderId, ConnectorAdapter> = {
  cursor: {
    endpoint: CURSOR_USAGE_EVENTS_PATH,
    async pull({ secret: apiKey }, window, deps) {
      const { events, httpCalls } = await fetchCursorUsageEvents(apiKey, window, deps)
      return { facts: normalizeCursorEvents(events), fromMs: window.startMs, httpCalls, refreshedAt: null }
    },
    async probe({ secret: apiKey }, now, deps) {
      await fetchCursorUsageEvents(apiKey, { startMs: now.getTime() - HOUR_MS, endMs: now.getTime() }, deps)
    },
  },
  anthropic: {
    endpoint: `${ANTHROPIC_USAGE_PATH} + ${ANTHROPIC_COST_PATH}`,
    async pull({ secret: apiKey }, window, deps) {
      // Hourly buckets; Anthropic drops the unfinished hour by rounding down.
      const pulled = await fetchAnthropicUsageAndCost(apiKey, { startMs: window.startMs, endMs: hourStart(window.endMs) }, deps)
      return { facts: normalizeAnthropicRows(pulled.usage, pulled.cost), fromMs: window.startMs, httpCalls: pulled.httpCalls, refreshedAt: pulled.refreshedAt }
    },
    async probe({ secret: apiKey }, now, deps) {
      const end = hourStart(now.getTime())
      await fetchAnthropicUsageAndCost(apiKey, { startMs: end - 24 * HOUR_MS, endMs: end }, deps)
    },
  },
  openai: {
    endpoint: `${OPENAI_USAGE_PATH} + ${OPENAI_COSTS_PATH}`,
    async pull({ secret: apiKey }, window, deps) {
      // Money is per UTC day, so a day is always re-read whole.
      const fromMs = Math.floor(window.startMs / DAY_MS) * DAY_MS
      const pulled = await fetchOpenAiUsageAndCosts(apiKey, { startMs: fromMs, endMs: window.endMs }, deps)
      return { facts: normalizeOpenAiBuckets(pulled.usage, pulled.costs), fromMs, httpCalls: pulled.httpCalls, refreshedAt: null }
    },
    async probe({ secret: apiKey }, now, deps) {
      const fromMs = Math.floor(now.getTime() / DAY_MS) * DAY_MS
      await fetchOpenAiUsageAndCosts(apiKey, { startMs: fromMs, endMs: now.getTime() }, deps)
    },
  },
  copilot: {
    endpoint: `${COPILOT_AI_CREDIT_PATH} + ${COPILOT_USERS_REPORT_PATH}`,
    async pull(credential, window, deps) {
      // GitHub bills and reports by UTC day, so a day is always re-read whole.
      const fromMs = utcDayStart(window.startMs)
      const pulled = await fetchCopilotDays(credential, { startMs: fromMs, endMs: window.endMs }, deps)
      return { facts: normalizeCopilotDays(pulled.days), fromMs, httpCalls: pulled.httpCalls, refreshedAt: null }
    },
    async probe(credential, now, deps) {
      await probeCopilot(credential, now, deps)
    },
  },
}

export function adapterFor(provider: string): ConnectorAdapter | undefined {
  return Object.hasOwn(ADAPTERS, provider) ? ADAPTERS[provider as UsageProviderId] : undefined
}
