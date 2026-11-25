// Records become hourly facts here. This is the last step before a batch, so
// it is also where the session id stops being itself: only a hash leaves.

import { createHash } from "node:crypto"
import type { CollectorTool, PlanWindow, Surface, UsageRecord } from "./record"

const HOUR_MS = 3_600_000

/** One (tool, surface, model, session, hour) total. What a batch carries. */
export type CollectorFact = {
  tool: CollectorTool
  surface: Surface
  model: string
  // sha256("<tool>:<session id>"), first 32 hex characters. Lets the server
  // show "one session burning alone" without receiving the id itself.
  sessionRef: string
  hourStart: string // ISO, UTC, on the hour
  requests: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
}

/** A plan window's peak and latest reading within one hour. */
export type PlanWindowFact = {
  tool: CollectorTool
  limitId: string
  window: "primary" | "secondary"
  windowMinutes: number
  hourStart: string
  peakPercent: number
  lastPercent: number
  lastObservedAt: string
  resetsAt: string | null
  planType: string | null
}

export function sessionRef(tool: CollectorTool, sessionId: string): string {
  return createHash("sha256").update(`${tool}:${sessionId}`).digest("hex").slice(0, 32)
}

const hourOf = (d: Date) => new Date(Math.floor(d.getTime() / HOUR_MS) * HOUR_MS).toISOString()

export function rollupRecords(records: Iterable<UsageRecord>): CollectorFact[] {
  const facts = new Map<string, CollectorFact>()
  for (const r of records) {
    const ref = sessionRef(r.tool, r.sessionId)
    const hourStart = hourOf(r.occurredAt)
    const key = JSON.stringify([r.tool, r.surface, r.model, ref, hourStart])
    let f = facts.get(key)
    if (!f) {
      f = {
        tool: r.tool, surface: r.surface, model: r.model, sessionRef: ref, hourStart, requests: 0,
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0,
      }
      facts.set(key, f)
    }
    f.requests++
    f.inputTokens += r.inputTokens
    f.outputTokens += r.outputTokens
    f.cacheReadTokens += r.cacheReadTokens
    f.cacheWriteTokens += r.cacheWriteTokens
    f.reasoningTokens += r.reasoningTokens
  }
  return [...facts.values()].sort((a, b) => a.hourStart.localeCompare(b.hourStart) || a.sessionRef.localeCompare(b.sessionRef))
}

export function rollupPlanWindows(windows: Iterable<PlanWindow>): PlanWindowFact[] {
  const out = new Map<string, PlanWindowFact>()
  for (const w of windows) {
    const hourStart = hourOf(w.observedAt)
    const key = JSON.stringify([w.tool, w.limitId, w.window, hourStart])
    const observed = w.observedAt.toISOString()
    const f = out.get(key)
    if (!f) {
      out.set(key, {
        tool: w.tool, limitId: w.limitId, window: w.window, windowMinutes: w.windowMinutes, hourStart,
        peakPercent: w.usedPercent, lastPercent: w.usedPercent, lastObservedAt: observed,
        resetsAt: w.resetsAt?.toISOString() ?? null, planType: w.planType,
      })
      continue
    }
    f.peakPercent = Math.max(f.peakPercent, w.usedPercent)
    if (observed >= f.lastObservedAt) {
      f.lastPercent = w.usedPercent
      f.lastObservedAt = observed
      f.windowMinutes = w.windowMinutes
      f.resetsAt = w.resetsAt?.toISOString() ?? null
      f.planType = w.planType ?? f.planType
    }
  }
  return [...out.values()].sort((a, b) => a.hourStart.localeCompare(b.hourStart) || a.window.localeCompare(b.window))
}
