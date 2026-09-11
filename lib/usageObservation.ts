import { createHash } from "node:crypto"
import { z } from "zod"

export const usageSources = ["claude-code", "codex"] as const
export type UsageSource = typeof usageSources[number]
export const sourceNames = { "claude-code": "Claude Code", codex: "Codex" }

// OTLP JSON logs only. Metrics can be cumulative and traces overlap logs;
// accepting either as additional usage would double-count the same requests.
const attributes = z.array(z.object({ key: z.string(), value: z.object({
  stringValue: z.string().optional(), intValue: z.union([z.string(), z.number()]).optional(),
  doubleValue: z.number().optional(), boolValue: z.boolean().optional(),
}) })).max(150)
const envelope = z.object({ resourceLogs: z.array(z.object({
  resource: z.object({ attributes: attributes.optional() }).optional(),
  scopeLogs: z.array(z.object({
    logRecords: z.array(z.object({
      timeUnixNano: z.string().regex(/^\d{1,20}$/),
      attributes: attributes.optional(),
      body: z.object({ stringValue: z.string().optional() }).nullish(),
      eventName: z.string().optional(),
    })).max(500),
  })).max(20),
})).max(20) })

type Attribute = z.infer<typeof attributes>[number]
function values(attrs: Attribute[] = []): Record<string, unknown> {
  return Object.fromEntries(attrs.map(a => [a.key, a.value.stringValue ?? a.value.intValue ?? a.value.doubleValue ?? a.value.boolValue]))
}
function label(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 200 ? value : null
}
function count(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null
  const n = typeof value === "string" ? Number(value) : value
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 2_147_483_647) throw Error("Invalid token count")
  return n
}

export type ObservedUsage = {
  source: UsageSource; eventId: string; sessionId: string; eventName: string;
  model: string | null; tokensIn: number | null; tokensOut: number | null;
  cacheReadTokens: number | null; cacheWriteTokens: number | null;
  estimatedCostUsd: number | null; occurredAt: Date;
}

export function normalizeUsage(source: UsageSource, body: unknown, now = new Date()): { events: ObservedUsage[]; ignored: number } {
  const parsed = envelope.parse(body)
  const events: ObservedUsage[] = []
  let ignored = 0, total = 0
  for (const resource of parsed.resourceLogs) for (const scope of resource.scopeLogs) for (const record of scope.logRecords) {
    if (++total > 500) throw Error("Batch exceeds 500 records")
    const a = { ...values(resource.resource?.attributes), ...values(record.attributes) }
    const name = label(a["event.name"]) ?? record.eventName ?? record.body?.stringValue ?? ""
    const sessionId = label(a["session.id"]) ?? label(a["conversation.id"])
    const claudeUsage = source === "claude-code" && ["api_request", "claude_code.api_request"].includes(name)
    const codexUsage = source === "codex" && name === "codex.sse_event" && (a["event.kind"] ?? a.kind) === "response.completed" && a.input_token_count !== undefined
    const activity = source === "claude-code"
      ? ["user_prompt", "claude_code.user_prompt", "tool_result", "claude_code.tool_result"].includes(name)
      : ["codex.conversation_starts", "codex.user_prompt", "codex.tool_result", "codex.tool_decision"].includes(name)
    if (!sessionId || !(claudeUsage || codexUsage || activity)) { ignored++; continue }
    // Codex 0.144.1 emits timeUnixNano=0 and carries the original time in
    // event.timestamp. Never substitute receipt time for an old event.
    const eventTime = record.timeUnixNano === "0" ? label(a["event.timestamp"]) : null
    const occurredAt = eventTime ? new Date(eventTime) : new Date(Number(BigInt(record.timeUnixNano) / BigInt(1_000_000)))
    if (!Number.isFinite(occurredAt.getTime()) || occurredAt.getTime() <= 0 || occurredAt.getTime() > now.getTime() + 300_000) throw Error("Invalid event time")
    const eventName = claudeUsage || codexUsage ? "model_usage" : name.includes("tool") ? "tool_activity" : "session_activity"
    const rawCost = claudeUsage ? a.cost_usd : undefined
    if (rawCost !== undefined && (rawCost === "" || !["string", "number"].includes(typeof rawCost))) throw Error("Invalid estimated cost")
    const estimatedCostUsd = rawCost === undefined ? null : Number(rawCost)
    if (estimatedCostUsd !== null && (!Number.isFinite(estimatedCostUsd) || estimatedCostUsd < 0 || estimatedCostUsd > 1_000_000)) throw Error("Invalid estimated cost")
    // Stable identity independent of batch order and receipt time. No raw text,
    // arguments, outputs, emails, paths, or resource attribute bags are retained.
    const identity = [source, sessionId, name, label(a.request_id) ?? label(a.client_request_id) ?? eventTime ?? record.timeUnixNano, a["event.sequence"] ?? null, a["event.kind"] ?? a.kind ?? null]
    events.push({
      source, sessionId, eventName, occurredAt,
      eventId: createHash("sha256").update(JSON.stringify(identity)).digest("hex"),
      model: label(a.model),
      tokensIn: claudeUsage ? count(a.input_tokens) : codexUsage ? count(a.input_token_count) : null,
      tokensOut: claudeUsage ? count(a.output_tokens) : codexUsage ? count(a.output_token_count) : null,
      cacheReadTokens: claudeUsage ? count(a.cache_read_tokens) : codexUsage ? count(a.cached_token_count) : null,
      cacheWriteTokens: claudeUsage ? count(a.cache_creation_tokens) : null,
      estimatedCostUsd,
    })
  }
  return { events, ignored }
}
