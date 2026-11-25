// Server side of the local usage collector (packages/sanction-collector):
// check a device's signed batch and turn it into the same FactInput rows the
// provider connectors write.
//
// Order matters. The signature is checked over the raw bytes before the body
// is parsed, so an unpaired caller never gets its JSON parsed. The schema is
// strict: an unknown field is a refusal, not something silently dropped,
// because an unexpected field is how content would start to leak in.
//
// Who the usage belongs to comes from the device record made at pairing,
// never from the batch. A device can only report usage for the person who
// paired it.
//
// Not wired to a route yet: the CollectorDevice table, the pairing flow and
// the endpoint are proposals (docs/plans/local-usage-collector.md).

import { createPublicKey, verify } from "node:crypto"
import { z } from "zod"
import { HOUR_MS, DAY_MS, type FactInput } from "@/lib/connectors/facts"

export const COLLECTOR_BATCH_SCHEMA = "sanction.collector.batch/1"
export const MAX_BATCH_BYTES = 2_000_000
const MAX_FACTS = 5_000
const MAX_WINDOWS = 2_000
// Claude Code deletes transcripts after 30 days by default; a first scan can
// reach back that far, plus a margin.
const BACKFILL_MS = 35 * DAY_MS
const CLOCK_SKEW_MS = 10 * 60_000
const MAX_BATCH_AGE_MS = DAY_MS
const MAX_COUNT = 1_000_000_000_000

const count = z.number().int().min(0).max(MAX_COUNT)
const onTheHour = z.iso.datetime().refine((s) => Date.parse(s) % HOUR_MS === 0, "not on the hour")
const tool = z.enum(["claude_code", "codex"])
const surface = z.enum(["cli", "ide", "app", "exec", "sdk", "other"])
const name = (re: RegExp) => z.string().regex(re)

const fact = z.strictObject({
  tool,
  surface,
  model: name(/^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,99}$/),
  sessionRef: name(/^[0-9a-f]{32}$/),
  hourStart: onTheHour,
  requests: z.number().int().min(1).max(1_000_000),
  inputTokens: count,
  outputTokens: count,
  cacheReadTokens: count,
  cacheWriteTokens: count,
  reasoningTokens: count,
})

const label = name(/^[a-z][a-z0-9_.-]{0,39}$/)

const planWindow = z.strictObject({
  tool,
  limitId: label,
  window: z.enum(["primary", "secondary"]),
  windowMinutes: z.number().int().min(1).max(527_040),
  hourStart: onTheHour,
  peakPercent: z.number().min(0).max(1_000),
  lastPercent: z.number().min(0).max(1_000),
  lastObservedAt: z.iso.datetime(),
  resetsAt: z.iso.datetime().nullable(),
  planType: label.nullable(),
})

const health = z.strictObject({
  parser: name(/^[a-z][a-z0-9-]{0,39}\/[a-z][a-z0-9-]{0,39}@[0-9]{1,4}$/),
  files: count,
  lines: count,
  records: count,
  malformedLines: count,
  unknownLineTypes: count,
  usageLinesWithoutUsage: count,
  skippedFiles: count,
  toolVersions: z.array(name(/^[0-9][0-9A-Za-z.+-]{0,39}$/)).max(20),
})

export const collectorBatchSchema = z.strictObject({
  schema: z.literal(COLLECTOR_BATCH_SCHEMA),
  batchId: z.uuid(),
  deviceId: name(/^[A-Za-z0-9_-]{8,64}$/),
  collectorVersion: name(/^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,6}$/),
  createdAt: z.iso.datetime(),
  facts: z.array(fact).max(MAX_FACTS),
  planWindows: z.array(planWindow).max(MAX_WINDOWS),
  health: z.array(health).max(10),
})

export type CollectorBatch = z.infer<typeof collectorBatchSchema>

/** What the server stored when the device was paired. */
export type CollectorDevice = {
  deviceId: string
  // Raw Ed25519 public key, base64url (32 bytes).
  publicKey: string
  // The person the device was paired to, as Sanction knows them. Becomes
  // rawIdentity on every fact, so a device cannot report for anyone else.
  personRef: string
  lastBatchAt: Date | null
  revokedAt: Date | null
}

export type PlanWindowSnapshot = {
  tool: CollectorBatch["planWindows"][number]["tool"]
  limitId: string
  window: "primary" | "secondary"
  windowMinutes: number
  hourStart: Date
  peakPercent: number
  lastPercent: number
  observedAt: Date
  resetsAt: Date | null
  planType: string | null
}

export type AcceptedBatch = {
  ok: true
  batch: CollectorBatch
  facts: FactInput[]
  planWindows: PlanWindowSnapshot[]
  drift: string[]
}
export type RejectedBatch = { ok: false; status: 400 | 401 | 409 | 413; reason: string }

/** Ed25519 over the exact request bytes. Header form: "ed25519=<base64url>". */
export function verifyCollectorSignature(rawBody: string, header: string | null | undefined, publicKey: string): boolean {
  const match = /^ed25519=([A-Za-z0-9_-]{86})$/.exec(header ?? "")
  if (!match || !/^[A-Za-z0-9_-]{43}$/.test(publicKey)) return false
  try {
    const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: publicKey }, format: "jwk" })
    return verify(null, Buffer.from(rawBody, "utf8"), key, Buffer.from(match[1], "base64url"))
  } catch {
    return false
  }
}

export function acceptCollectorBatch(
  rawBody: string,
  signatureHeader: string | null | undefined,
  device: CollectorDevice,
  now = new Date(),
): AcceptedBatch | RejectedBatch {
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BATCH_BYTES) return { ok: false, status: 413, reason: "batch too large" }
  if (device.revokedAt) return { ok: false, status: 401, reason: "device revoked" }
  if (!verifyCollectorSignature(rawBody, signatureHeader, device.publicKey)) return { ok: false, status: 401, reason: "bad signature" }

  let json: unknown
  try {
    json = JSON.parse(rawBody)
  } catch {
    return { ok: false, status: 400, reason: "body is not JSON" }
  }
  const parsed = collectorBatchSchema.safeParse(json)
  if (!parsed.success) return { ok: false, status: 400, reason: `batch does not match ${COLLECTOR_BATCH_SCHEMA}` }
  const batch = parsed.data
  if (batch.deviceId !== device.deviceId) return { ok: false, status: 401, reason: "device mismatch" }

  const created = Date.parse(batch.createdAt)
  const nowMs = now.getTime()
  if (created > nowMs + CLOCK_SKEW_MS) return { ok: false, status: 400, reason: "batch is from the future" }
  if (created < nowMs - MAX_BATCH_AGE_MS) return { ok: false, status: 409, reason: "batch is stale" }
  // Each batch carries whole-hour totals that replace the stored ones, so an
  // older batch arriving late would lower a total. Only newer batches count.
  if (device.lastBatchAt && created <= device.lastBatchAt.getTime()) return { ok: false, status: 409, reason: "batch is not newer than the last one" }

  const earliest = nowMs - BACKFILL_MS
  const latest = nowMs + HOUR_MS
  for (const f of [...batch.facts, ...batch.planWindows]) {
    const t = Date.parse(f.hourStart)
    if (t < earliest || t > latest) return { ok: false, status: 400, reason: "hour outside the accepted range" }
  }

  return {
    ok: true,
    batch,
    facts: normalizeCollectorFacts(batch, device.personRef),
    planWindows: batch.planWindows.map((w) => ({
      tool: w.tool,
      limitId: w.limitId,
      window: w.window,
      windowMinutes: w.windowMinutes,
      hourStart: new Date(w.hourStart),
      peakPercent: w.peakPercent,
      lastPercent: w.lastPercent,
      observedAt: new Date(w.lastObservedAt),
      resetsAt: w.resetsAt ? new Date(w.resetsAt) : null,
      planType: w.planType,
    })),
    drift: parserDrift(batch.health),
  }
}

// Each tool maps onto the provider and surface the admin-API connectors
// already use, so a person's Claude Code usage reads the same whether it came
// from their org's Admin API or from their own laptop.
const PROVIDER = { claude_code: "anthropic", codex: "openai" } as const

export function normalizeCollectorFacts(batch: CollectorBatch, personRef: string): FactInput[] {
  return batch.facts.map((f) => {
    const start = Date.parse(f.hourStart)
    return {
      provider: PROVIDER[f.tool],
      surface: f.tool === "claude_code" ? "claude_code" : f.surface === "ide" ? "ide" : "agent",
      rawIdentity: personRef,
      identityType: "user",
      model: f.model,
      sessionRef: f.sessionRef,
      automationRef: null,
      // codex exec and SDK runs have no person watching them.
      headless: f.surface === "exec" || f.surface === "sdk",
      bucketStart: new Date(start),
      bucketEnd: new Date(start + HOUR_MS),
      inputTokens: BigInt(f.inputTokens),
      outputTokens: BigInt(f.outputTokens),
      cacheReadTokens: BigInt(f.cacheReadTokens),
      cacheWriteTokens: BigInt(f.cacheWriteTokens),
      tokenReportedRequests: f.requests,
      requests: f.requests,
      // A personal plan is paid by subscription; tokens are a value inside
      // the plan, never an extra charge. Pricing them is the server's job.
      costNanos: BigInt(0),
      costBasis: "included",
    }
  })
}

/**
 * Plain-language warnings when a parser looks blind: the tool changed its
 * file format and this collector version no longer reads it. Without this, a
 * format change looks exactly like a person who stopped using the tool.
 */
export function parserDrift(healths: CollectorBatch["health"]): string[] {
  const out: string[] = []
  for (const h of healths) {
    if (h.usageLinesWithoutUsage > 0 && h.records === 0) out.push(`${h.parser}: found usage lines but could read none`)
    else if (h.usageLinesWithoutUsage > Math.max(10, h.records * 0.05)) out.push(`${h.parser}: many usage lines unreadable`)
    if (h.lines > 100 && h.unknownLineTypes > h.lines * 0.05) out.push(`${h.parser}: many unknown line types`)
    if (h.skippedFiles > 0) out.push(`${h.parser}: ${h.skippedFiles} session files in a format this version cannot read`)
  }
  return out
}
