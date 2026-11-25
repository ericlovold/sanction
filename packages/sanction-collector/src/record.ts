// The only shape that leaves a parser. Everything a parser reads from a
// local file is projected into UsageRecord or PlanWindow here; any field not
// named below cannot reach a batch, because the batch is built from these
// types alone. Prompts, responses, tool input/output, file paths, working
// directories, git remotes, emails and account ids have no field to land in.

export const COLLECTOR_TOOLS = ["claude_code", "codex"] as const
export type CollectorTool = (typeof COLLECTOR_TOOLS)[number]

// Where in the tool the usage happened. Coarse on purpose: enough to tell the
// CLI from the IDE extension from the desktop app, nothing about the project.
export type Surface = "cli" | "ide" | "app" | "exec" | "sdk" | "other"

/** One model call, after dedupe. Never sent as is: rollup.ts buckets it. */
export type UsageRecord = {
  tool: CollectorTool
  toolVersion: string | null
  surface: Surface
  sessionId: string
  model: string
  occurredAt: Date
  // Counted once per model response. Local-only: used to dedupe, then dropped.
  dedupeKey: string
  // Normalized like lib/connectors: inputTokens EXCLUDES cache reads/writes.
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  // Part of outputTokens, reported separately when the tool splits it out.
  reasoningTokens: number
}

/**
 * A subscription usage window as the tool itself reports it (Codex plan
 * limits). usedPercent can exceed 100 when a plan allows overage.
 */
export type PlanWindow = {
  tool: CollectorTool
  observedAt: Date
  limitId: string
  window: "primary" | "secondary"
  windowMinutes: number
  usedPercent: number
  resetsAt: Date | null
  planType: string | null
}

// Values that come from a file are checked before they become a field.
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,99}$/
const TOKEN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{5,79}$/
const VERSION = /^[0-9][0-9A-Za-z.+-]{0,39}$/
const LABEL = /^[a-z][a-z0-9_.-]{0,39}$/

export function modelName(value: unknown): string | null {
  return typeof value === "string" && MODEL.test(value) ? value : null
}

/** Session and request ids: opaque random tokens only, never free text. */
export function opaqueId(value: unknown): string | null {
  return typeof value === "string" && TOKEN_ID.test(value) ? value : null
}

export function versionString(value: unknown): string | null {
  return typeof value === "string" && VERSION.test(value) ? value : null
}

export function label(value: unknown): string | null {
  return typeof value === "string" && LABEL.test(value) ? value : null
}

/** A non-negative integer token count, or 0 when absent or malformed. */
export function tokens(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

export function isoTime(value: unknown): Date | null {
  if (typeof value !== "string" || value.length > 40) return null
  const d = new Date(value)
  return Number.isFinite(d.getTime()) ? d : null
}
