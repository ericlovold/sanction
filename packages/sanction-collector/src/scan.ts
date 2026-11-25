// One scan: find the session files, parse them, roll them up. No network.

import { claudeCodeRoots, codexRoots, findClaudeCode, findCodex, readLines, type Env } from "./discover"
import { parseClaudeCode, CLAUDE_CODE_PARSER } from "./parsers/claudeCode"
import { parseCodex, CODEX_PARSER } from "./parsers/codex"
import { emptyHealth, type ParserHealth } from "./parsers/health"
import { rollupPlanWindows, rollupRecords, type CollectorFact, type PlanWindowFact } from "./rollup"
import type { CollectorTool } from "./record"

export type ScanResult = {
  facts: CollectorFact[]
  planWindows: PlanWindowFact[]
  health: ParserHealth[]
}

export type ScanOptions = {
  // Tools the person turned on. Nothing is read for a tool left out.
  tools: readonly CollectorTool[]
  // Only files changed at or after this time. Null reads everything.
  since: Date | null
  env?: Env
  home?: string
}

const lazily = (paths: string[]) => paths.map((p) => ({ [Symbol.iterator]: () => readLines(p) }))

export function scan(opts: ScanOptions): ScanResult {
  const facts: CollectorFact[] = []
  const planWindows: PlanWindowFact[] = []
  const health: ParserHealth[] = []

  if (opts.tools.includes("claude_code")) {
    const found = findClaudeCode(claudeCodeRoots(opts.env, opts.home), opts.since)
    const h = emptyHealth(CLAUDE_CODE_PARSER)
    const { records } = parseClaudeCode(lazily(found.files), h)
    facts.push(...rollupRecords(records))
    health.push(h)
  }
  if (opts.tools.includes("codex")) {
    const found = findCodex(codexRoots(opts.env, opts.home), opts.since)
    const h = emptyHealth(CODEX_PARSER)
    h.skippedFiles += found.skippedFiles
    const parsed = parseCodex(lazily(found.files), h)
    facts.push(...rollupRecords(parsed.records))
    planWindows.push(...rollupPlanWindows(parsed.planWindows))
    health.push(h)
  }
  return { facts, planWindows, health }
}
