// Codex session rollouts: $CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl
//
// OpenAI says the rollout "format isn't a stable interface". This parser reads
// four line types and copies nothing else out of them:
//   session_meta        session id, cli_version, originator   (cwd, git and
//                       instructions are on the same line and are never read)
//   turn_context        model per turn                        (cwd is not read)
//   token_usage_record  one row per model response, keyed by response_id
//                       (newer Codex; verified on 0.172.0)
//   event_msg/token_count  cumulative totals, plus rate_limits: the ChatGPT
//                       plan's usage windows, the only local source of them
//
// When a file has token_usage_record lines, they are the source of tokens and
// token_count is read only for rate limits. Older files fall back to the
// difference between consecutive cumulative totals, which skips the repeated
// token_count events older versions wrote.

import { emptyHealth, noteVersion, obj, parseLine, type ParserHealth } from "./health"
import { isoTime, label, modelName, opaqueId, tokens, versionString, type PlanWindow, type Surface, type UsageRecord } from "../record"

export const CODEX_PARSER = "codex/rollout@1"

const KNOWN_TYPES = new Set([
  "session_meta", "turn_context", "event_msg", "response_item", "token_usage_record",
  "compacted", "world_state",
])

const SURFACES: Record<string, Surface> = {
  codex_cli_rs: "cli",
  codex_tui: "cli",
  codex_exec: "exec",
  codex_vscode: "ide",
  codex_jetbrains: "ide",
  codex_desktop: "app",
  "codex desktop": "app",
  codex_sdk_ts: "sdk",
}

export function codexSurface(originator: unknown): Surface {
  if (typeof originator !== "string" || originator.length > 40) return "other"
  return SURFACES[originator.toLowerCase()] ?? "other"
}

type Usage = { input: number; cached: number; cacheWrite: number; output: number; reasoning: number }

function usageOf(value: unknown): Usage | null {
  const u = obj(value)
  if (!u || typeof u.input_tokens !== "number" || typeof u.output_tokens !== "number") return null
  return {
    input: tokens(u.input_tokens),
    cached: tokens(u.cached_input_tokens),
    cacheWrite: tokens(u.cache_write_input_tokens),
    output: tokens(u.output_tokens),
    reasoning: tokens(u.reasoning_output_tokens),
  }
}

const ZERO: Usage = { input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0 }

function minus(a: Usage, b: Usage): Usage {
  return {
    input: a.input - b.input, cached: a.cached - b.cached, cacheWrite: a.cacheWrite - b.cacheWrite,
    output: a.output - b.output, reasoning: a.reasoning - b.reasoning,
  }
}

const isZero = (u: Usage) => u.input === 0 && u.cached === 0 && u.cacheWrite === 0 && u.output === 0 && u.reasoning === 0
const anyNegative = (u: Usage) => u.input < 0 || u.cached < 0 || u.cacheWrite < 0 || u.output < 0 || u.reasoning < 0

function windowOf(raw: unknown, which: "primary" | "secondary", base: Record<string, unknown>, observedAt: Date): PlanWindow | null {
  const w = obj(raw)
  if (!w || typeof w.used_percent !== "number" || !Number.isFinite(w.used_percent) || w.used_percent < 0) return null
  const minutes = tokens(w.window_minutes)
  if (minutes === 0) return null
  let resetsAt: Date | null = null
  if (typeof w.resets_at === "number" && w.resets_at > 0) resetsAt = new Date(w.resets_at * 1000)
  // Older Codex reported seconds until reset instead of a timestamp.
  else if (typeof w.resets_in_seconds === "number" && w.resets_in_seconds >= 0) resetsAt = new Date(observedAt.getTime() + w.resets_in_seconds * 1000)
  return {
    tool: "codex",
    observedAt,
    limitId: label(base.limit_id) ?? "codex",
    window: which,
    windowMinutes: minutes,
    usedPercent: Math.round(w.used_percent * 100) / 100,
    resetsAt,
    planType: label(base.plan_type),
  }
}

export type CodexResult = { records: UsageRecord[]; planWindows: PlanWindow[]; health: ParserHealth }

/** Parse rollout files. Each inner iterable is one file's lines. */
export function parseCodex(files: Iterable<Iterable<string>>, health = emptyHealth(CODEX_PARSER)): CodexResult {
  const byKey = new Map<string, UsageRecord>()
  const planWindows: PlanWindow[] = []

  for (const lines of files) {
    health.files++
    const rows: Record<string, unknown>[] = []
    for (const line of lines) {
      const row = parseLine(line, health)
      if (!row) continue
      if (!KNOWN_TYPES.has(String(row.type))) health.unknownLineTypes++
      rows.push(row)
    }
    const hasRecords = rows.some((r) => r.type === "token_usage_record")

    let sessionId: string | null = null
    let version: string | null = null
    let surface: Surface = "other"
    let model: string | null = null
    const modelByTurn = new Map<string, string>()
    let lastTotal: Usage | null = null

    const emit = (u: Usage, at: Date, key: string, m: string | null) => {
      if (!sessionId || !m) {
        health.usageLinesWithoutUsage++
        return
      }
      if (byKey.has(key)) return
      byKey.set(key, {
        tool: "codex", toolVersion: version, surface, sessionId, model: m, occurredAt: at, dedupeKey: key,
        // OpenAI's input_tokens includes cached and cache-write tokens.
        inputTokens: Math.max(0, u.input - u.cached - u.cacheWrite),
        outputTokens: u.output,
        cacheReadTokens: u.cached,
        cacheWriteTokens: u.cacheWrite,
        reasoningTokens: u.reasoning,
      })
    }

    rows.forEach((row) => {
      const payload = obj(row.payload)
      const at = isoTime(row.timestamp)
      if (row.type === "session_meta" && payload) {
        sessionId = opaqueId(payload.id) ?? opaqueId(payload.session_id) ?? sessionId
        version = versionString(payload.cli_version) ?? version
        surface = codexSurface(payload.originator)
        noteVersion(health, version)
        return
      }
      if (row.type === "turn_context" && payload) {
        const m = modelName(payload.model)
        if (m) {
          model = m
          const turn = opaqueId(payload.turn_id)
          if (turn) modelByTurn.set(turn, m)
        }
        return
      }
      if (row.type === "token_usage_record" && payload) {
        const u = usageOf(payload.usage)
        const responseId = opaqueId(payload.response_id)
        if (!u || !responseId || !at) {
          health.usageLinesWithoutUsage++
          return
        }
        const turn = opaqueId(payload.turn_id)
        emit(u, at, `codex:${responseId}`, (turn && modelByTurn.get(turn)) || model)
        return
      }
      if (row.type !== "event_msg" || !payload || payload.type !== "token_count" || !at) return

      const limits = obj(payload.rate_limits)
      if (limits) {
        for (const which of ["primary", "secondary"] as const) {
          const w = windowOf(limits[which], which, limits, at)
          if (w) planWindows.push(w)
        }
      }
      const info = obj(payload.info)
      // info: null is a rate-limit-only update, not a model call.
      if (!info || hasRecords) return
      const total = usageOf(info.total_token_usage)
      if (!total) {
        health.usageLinesWithoutUsage++
        return
      }
      let delta = minus(total, lastTotal ?? ZERO)
      // A shrinking total means the session reset its counter; trust the last call.
      if (anyNegative(delta)) delta = usageOf(info.last_token_usage) ?? ZERO
      lastTotal = total
      if (isZero(delta)) return
      // The running total names the call: it only grows within a session, and
      // a resumed session that copies earlier lines repeats the same totals.
      const t = total
      emit(delta, at, `codex:${sessionId ?? "?"}:${t.input}:${t.cached}:${t.cacheWrite}:${t.output}:${t.reasoning}`, model)
    })
  }

  const records = [...byKey.values()]
  health.records += records.length
  return { records, planWindows, health }
}
