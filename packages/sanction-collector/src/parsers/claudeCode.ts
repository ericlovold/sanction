// Claude Code session transcripts: <config dir>/projects/<project>/<session>.jsonl
//
// Anthropic documents this format as internal ("changes between versions, so
// scripts that parse these files directly can break on any release"), so this
// parser reads as little as possible: assistant lines, their model, ids and
// usage counters. Everything else on the line (message content, tool input and
// output, cwd, gitBranch) is never copied out.
//
// Verified against Claude Code 2.1.332 (2026-11-25). One API response is
// written as several lines, one per content block (apiBlockIndex), each
// repeating the same usage, so a response is counted once per message.id.

import { emptyHealth, noteVersion, obj, parseLine, type ParserHealth } from "./health"
import { isoTime, label, modelName, opaqueId, tokens, versionString, type Surface, type UsageRecord } from "../record"

export const CLAUDE_CODE_PARSER = "claude-code/transcript@1"

// Line types known to this parser version. Anything else counts as unknown,
// which is how a format change shows up in the batch's health counts.
const KNOWN_TYPES = new Set([
  "assistant", "user", "attachment", "system", "summary", "queue-operation",
  "last-prompt", "cost-state", "atis-latch", "file-history-snapshot", "progress",
])

const SURFACES: Record<string, Surface> = {
  cli: "cli",
  "claude-vscode": "ide",
  "claude-jetbrains": "ide",
  "claude-desktop": "app",
  "sdk-ts": "sdk",
  "sdk-py": "sdk",
  "sdk-cli": "sdk",
}

export function claudeCodeSurface(entrypoint: unknown): Surface {
  const e = label(entrypoint)
  return (e && SURFACES[e]) || "other"
}

export type ParseResult = { records: UsageRecord[]; health: ParserHealth }

/**
 * Parse one or more transcript files' lines. Records are deduped by response
 * across everything passed in, so a response repeated in a subagent file or a
 * set-aside copy is still counted once.
 */
export function parseClaudeCode(files: Iterable<Iterable<string>>, health = emptyHealth(CLAUDE_CODE_PARSER)): ParseResult {
  const byKey = new Map<string, UsageRecord>()
  for (const lines of files) {
    health.files++
    for (const line of lines) {
      const row = parseLine(line, health)
      if (!row) continue
      const type = typeof row.type === "string" ? row.type : ""
      if (!KNOWN_TYPES.has(type)) health.unknownLineTypes++
      if (type !== "assistant") continue

      const message = obj(row.message)
      const usage = obj(message?.usage)
      const model = modelName(message?.model)
      const occurredAt = isoTime(row.timestamp)
      const sessionId = opaqueId(row.sessionId)
      const messageId = opaqueId(message?.id)
      const requestId = opaqueId(row.requestId)
      // Claude Code writes "<synthetic>" assistant lines for local errors; they
      // carry no model call and fail modelName() on purpose.
      if (message?.model === "<synthetic>") continue
      if (!usage || !model || !occurredAt || !sessionId || !(messageId || requestId)) {
        health.usageLinesWithoutUsage++
        continue
      }
      const version = versionString(row.version)
      noteVersion(health, version)
      const details = obj(usage.output_tokens_details)
      const record: UsageRecord = {
        tool: "claude_code",
        toolVersion: version,
        surface: claudeCodeSurface(row.entrypoint),
        sessionId,
        model,
        occurredAt,
        dedupeKey: `claude_code:${messageId ?? ""}:${requestId ?? ""}`,
        // Anthropic's input_tokens already excludes cache reads and writes.
        inputTokens: tokens(usage.input_tokens),
        outputTokens: tokens(usage.output_tokens),
        cacheReadTokens: tokens(usage.cache_read_input_tokens),
        cacheWriteTokens: tokens(usage.cache_creation_input_tokens),
        reasoningTokens: tokens(details?.thinking_tokens),
      }
      const seen = byKey.get(record.dedupeKey)
      if (!seen) {
        byKey.set(record.dedupeKey, record)
        continue
      }
      // Same response written again. Early streaming lines have carried
      // placeholder output counts in some versions, so keep the largest.
      seen.inputTokens = Math.max(seen.inputTokens, record.inputTokens)
      seen.outputTokens = Math.max(seen.outputTokens, record.outputTokens)
      seen.cacheReadTokens = Math.max(seen.cacheReadTokens, record.cacheReadTokens)
      seen.cacheWriteTokens = Math.max(seen.cacheWriteTokens, record.cacheWriteTokens)
      seen.reasoningTokens = Math.max(seen.reasoningTokens, record.reasoningTokens)
    }
  }
  const records = [...byKey.values()]
  health.records += records.length
  return { records, health }
}
