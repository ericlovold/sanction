// Server side of the local collector: signature, schema, freshness, and the
// mapping into the same FactInput rows the provider connectors write.

import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  acceptCollectorBatch,
  normalizeCollectorFacts,
  parserDrift,
  verifyCollectorSignature,
  MAX_BATCH_BYTES,
  type CollectorDevice,
} from "../lib/collectorBatch"
import { factDedupeKey } from "../lib/connectors/facts"
import { parseClaudeCode } from "../packages/sanction-collector/src/parsers/claudeCode"
import { parseCodex } from "../packages/sanction-collector/src/parsers/codex"
import { rollupPlanWindows, rollupRecords } from "../packages/sanction-collector/src/rollup"
import { buildBatch, encodeBatch, generateDeviceKey, signBody, type CollectorBatch } from "../packages/sanction-collector/src/batch"

const FIX = join(__dirname, "fixtures/collector")
const lines = (name: string) => readFileSync(join(FIX, name), "utf8").split("\n")
const NOW = new Date("2026-11-21T12:00:00Z")
const key = generateDeviceKey()

function device(over: Partial<CollectorDevice> = {}): CollectorDevice {
  return { deviceId: "dev_test_0001", publicKey: key.publicKey, personRef: "user_eric", lastBatchAt: null, revokedAt: null, ...over }
}

function fixtureBatch(over: Partial<CollectorBatch> = {}): CollectorBatch {
  const claude = parseClaudeCode([lines("claude-session.jsonl"), lines("claude-subagent.jsonl")])
  const codex = parseCodex([lines("codex-rollout.jsonl"), lines("codex-rollout-legacy.jsonl")])
  return {
    ...buildBatch({
      deviceId: "dev_test_0001",
      facts: [...rollupRecords(claude.records), ...rollupRecords(codex.records)],
      planWindows: rollupPlanWindows(codex.planWindows),
      health: [claude.health, codex.health],
      now: NOW,
    }),
    ...over,
  }
}

function signed(body: unknown) {
  const raw = typeof body === "string" ? body : JSON.stringify(body)
  return { raw, header: `ed25519=${signBody(raw, key.privateKeyPem)}` }
}

describe("acceptCollectorBatch", () => {
  it("accepts a signed batch and maps it onto the connector grain", () => {
    const { raw, header } = signed(encodeBatch(fixtureBatch()))
    const result = acceptCollectorBatch(raw, header, device(), NOW)
    if (!result.ok) throw new Error(result.reason)

    expect(result.facts).toHaveLength(6)
    const claude = result.facts.find((f) => f.model === "claude-sonnet-5-5")!
    expect(claude).toMatchObject({
      provider: "anthropic", surface: "claude_code", rawIdentity: "user_eric", identityType: "user",
      automationRef: null, headless: false, costBasis: "included", costNanos: BigInt(0),
      inputTokens: BigInt(3000), outputTokens: BigInt(120), cacheReadTokens: BigInt(9000), cacheWriteTokens: BigInt(500),
      requests: 1, tokenReportedRequests: 1,
    })
    expect(claude.bucketEnd.getTime() - claude.bucketStart.getTime()).toBe(3_600_000)
    expect(claude.sessionRef).toMatch(/^[0-9a-f]{32}$/)
    // The haiku call came from the VS Code extension; Claude Code keeps one surface either way.
    expect(result.facts.find((f) => f.model === "claude-haiku-5-5")?.surface).toBe("claude_code")
    expect(result.facts.find((f) => f.model === "gpt-5.5-codex")).toMatchObject({ provider: "openai", surface: "agent" })
    expect(result.facts.find((f) => f.model === "gpt-5")).toMatchObject({ provider: "openai", surface: "ide" })

    expect(result.planWindows.find((w) => w.window === "primary" && w.hourStart.toISOString() === "2026-11-20T14:00:00.000Z")).toMatchObject({
      limitId: "codex", peakPercent: 19, lastPercent: 17, planType: "plus",
    })
    expect(result.drift).toEqual([])
  })

  it("marks codex exec and SDK runs as headless", () => {
    const batch = fixtureBatch()
    batch.facts = batch.facts.map((f) => (f.tool === "codex" ? { ...f, surface: "exec" as const } : f))
    const facts = normalizeCollectorFacts(batch, "user_eric")
    expect(facts.filter((f) => f.provider === "openai").every((f) => f.headless && f.surface === "agent")).toBe(true)
  })

  it("resending the same hours produces the same fact keys, so it replaces instead of adding", () => {
    const a = normalizeCollectorFacts(fixtureBatch(), "user_eric").map((f) => factDedupeKey("conn_1", f))
    const b = normalizeCollectorFacts(fixtureBatch({ batchId: "9a4e1d7c-0000-4000-8000-000000000001" }), "user_eric").map((f) => factDedupeKey("conn_1", f))
    expect(b).toEqual(a)
  })

  it("refuses an oversized body before doing anything else", () => {
    const result = acceptCollectorBatch("x".repeat(MAX_BATCH_BYTES + 1), null, device(), NOW)
    expect(result).toEqual({ ok: false, status: 413, reason: "batch too large" })
  })

  it("refuses a revoked device and a bad or missing signature", () => {
    const { raw, header } = signed(encodeBatch(fixtureBatch()))
    expect(acceptCollectorBatch(raw, header, device({ revokedAt: NOW }), NOW)).toMatchObject({ status: 401, reason: "device revoked" })
    expect(acceptCollectorBatch(raw, null, device(), NOW)).toMatchObject({ status: 401, reason: "bad signature" })
    expect(acceptCollectorBatch(raw, header.replace("ed25519=", "rsa="), device(), NOW)).toMatchObject({ status: 401 })
    expect(acceptCollectorBatch(raw, header, device({ publicKey: generateDeviceKey().publicKey }), NOW)).toMatchObject({ status: 401 })
    expect(acceptCollectorBatch(raw, header, device({ publicKey: "not-a-key" }), NOW)).toMatchObject({ status: 401 })
    // Signed, then edited in transit.
    expect(acceptCollectorBatch(raw.replace('"requests":1', '"requests":9'), header, device(), NOW)).toMatchObject({ status: 401 })
  })

  it("refuses bodies that are not the batch schema, including one extra field", () => {
    const notJson = signed("{not json")
    expect(acceptCollectorBatch(notJson.raw, notJson.header, device(), NOW)).toMatchObject({ status: 400, reason: "body is not JSON" })

    const batch = fixtureBatch()
    const extra = signed({ ...batch, facts: [{ ...batch.facts[0], prompt: "hello" }, ...batch.facts.slice(1)] })
    expect(acceptCollectorBatch(extra.raw, extra.header, device(), NOW)).toMatchObject({ status: 400 })

    const topLevel = signed({ ...batch, cwd: "/Users/someone" })
    expect(acceptCollectorBatch(topLevel.raw, topLevel.header, device(), NOW)).toMatchObject({ status: 400 })

    const offHour = signed({ ...batch, facts: [{ ...batch.facts[0], hourStart: "2026-11-20T10:30:00.000Z" }] })
    expect(acceptCollectorBatch(offHour.raw, offHour.header, device(), NOW)).toMatchObject({ status: 400 })

    const badRef = signed({ ...batch, facts: [{ ...batch.facts[0], sessionRef: "6f1c2b9e-1111-4aaa-8bbb-00000000000a" }] })
    expect(acceptCollectorBatch(badRef.raw, badRef.header, device(), NOW)).toMatchObject({ status: 400 })
  })

  it("refuses a batch for another device", () => {
    const { raw, header } = signed(fixtureBatch({ deviceId: "dev_someone_else" }))
    expect(acceptCollectorBatch(raw, header, device(), NOW)).toMatchObject({ status: 401, reason: "device mismatch" })
  })

  it("refuses batches from the future, stale ones and ones older than the last", () => {
    const future = signed(fixtureBatch({ createdAt: new Date(NOW.getTime() + 11 * 60_000).toISOString() }))
    expect(acceptCollectorBatch(future.raw, future.header, device(), NOW)).toMatchObject({ status: 400 })

    const stale = signed(fixtureBatch({ createdAt: new Date(NOW.getTime() - 2 * 86_400_000).toISOString() }))
    expect(acceptCollectorBatch(stale.raw, stale.header, device(), NOW)).toMatchObject({ status: 409, reason: "batch is stale" })

    const replay = signed(fixtureBatch())
    expect(acceptCollectorBatch(replay.raw, replay.header, device({ lastBatchAt: NOW }), NOW)).toMatchObject({ status: 409 })
    expect(acceptCollectorBatch(replay.raw, replay.header, device({ lastBatchAt: new Date(NOW.getTime() - 1) }), NOW).ok).toBe(true)
  })

  it("refuses hours outside the backfill range", () => {
    const batch = fixtureBatch()
    const tooOld = signed({ ...batch, facts: [{ ...batch.facts[0], hourStart: "2026-10-01T00:00:00.000Z" }] })
    expect(acceptCollectorBatch(tooOld.raw, tooOld.header, device(), NOW)).toMatchObject({ status: 400, reason: "hour outside the accepted range" })
    const ahead = signed({ ...batch, planWindows: [{ ...batch.planWindows[0], hourStart: "2026-11-21T15:00:00.000Z" }] })
    expect(acceptCollectorBatch(ahead.raw, ahead.header, device(), NOW)).toMatchObject({ status: 400 })
  })
})

describe("verifyCollectorSignature", () => {
  it("needs the ed25519= form with a 64-byte signature", () => {
    const raw = "{}"
    const sig = signBody(raw, key.privateKeyPem)
    expect(verifyCollectorSignature(raw, `ed25519=${sig}`, key.publicKey)).toBe(true)
    expect(verifyCollectorSignature(raw, sig, key.publicKey)).toBe(false)
    expect(verifyCollectorSignature(raw, `ed25519=${sig.slice(1)}`, key.publicKey)).toBe(false)
    expect(verifyCollectorSignature(raw, undefined, key.publicKey)).toBe(false)
  })
})

describe("parserDrift", () => {
  const h = (over: object) => ({
    parser: "codex/rollout@1", files: 3, lines: 1000, records: 200, malformedLines: 0, unknownLineTypes: 0,
    usageLinesWithoutUsage: 0, skippedFiles: 0, toolVersions: [], ...over,
  })

  it("is quiet for a healthy parser", () => {
    expect(parserDrift([h({})])).toEqual([])
    expect(parserDrift([h({ usageLinesWithoutUsage: 5 })])).toEqual([])
  })

  it("names a parser that went blind or is seeing a new format", () => {
    expect(parserDrift([h({ records: 0, usageLinesWithoutUsage: 40 })])).toEqual(["codex/rollout@1: found usage lines but could read none"])
    expect(parserDrift([h({ usageLinesWithoutUsage: 30 })])).toEqual(["codex/rollout@1: many usage lines unreadable"])
    expect(parserDrift([h({ unknownLineTypes: 80 })])).toEqual(["codex/rollout@1: many unknown line types"])
    expect(parserDrift([h({ skippedFiles: 4 })])).toEqual(["codex/rollout@1: 4 session files in a format this version cannot read"])
  })
})
