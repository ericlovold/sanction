// The one thing that leaves the device: a signed batch of hourly counts.
//
// Every field is copied by name from the rollup types, so a property that
// slipped onto a record by mistake still cannot reach the wire. The device
// signs the exact bytes it sends with an Ed25519 key made at pairing; the
// server checks the signature against the public key it stored then, so a
// batch cannot be forged for another device, and a stolen batch cannot be
// edited.

import { generateKeyPairSync, randomUUID, sign } from "node:crypto"
import type { ParserHealth } from "./parsers/health"
import type { CollectorFact, PlanWindowFact } from "./rollup"

export const BATCH_SCHEMA = "sanction.collector.batch/1"
export const COLLECTOR_VERSION = "0.1.0"

export type CollectorBatch = {
  schema: typeof BATCH_SCHEMA
  // Fresh per batch. The server keeps recent ids to refuse a replay.
  batchId: string
  // Given by the server at pairing. Not a hardware id and not a person.
  deviceId: string
  collectorVersion: string
  createdAt: string
  facts: CollectorFact[]
  planWindows: PlanWindowFact[]
  health: ParserHealth[]
}

export function buildBatch(input: {
  deviceId: string
  facts: CollectorFact[]
  planWindows: PlanWindowFact[]
  health: ParserHealth[]
  now?: Date
  batchId?: string
}): CollectorBatch {
  return {
    schema: BATCH_SCHEMA,
    batchId: input.batchId ?? randomUUID(),
    deviceId: input.deviceId,
    collectorVersion: COLLECTOR_VERSION,
    createdAt: (input.now ?? new Date()).toISOString(),
    facts: input.facts.map((f) => ({
      tool: f.tool, surface: f.surface, model: f.model, sessionRef: f.sessionRef, hourStart: f.hourStart,
      requests: f.requests, inputTokens: f.inputTokens, outputTokens: f.outputTokens,
      cacheReadTokens: f.cacheReadTokens, cacheWriteTokens: f.cacheWriteTokens, reasoningTokens: f.reasoningTokens,
    })),
    planWindows: input.planWindows.map((w) => ({
      tool: w.tool, limitId: w.limitId, window: w.window, windowMinutes: w.windowMinutes, hourStart: w.hourStart,
      peakPercent: w.peakPercent, lastPercent: w.lastPercent, lastObservedAt: w.lastObservedAt,
      resetsAt: w.resetsAt, planType: w.planType,
    })),
    health: input.health.map((h) => ({
      parser: h.parser, files: h.files, lines: h.lines, records: h.records, malformedLines: h.malformedLines,
      unknownLineTypes: h.unknownLineTypes, usageLinesWithoutUsage: h.usageLinesWithoutUsage,
      skippedFiles: h.skippedFiles, toolVersions: [...h.toolVersions],
    })),
  }
}

/** The request body. Signed and sent byte for byte; the server never re-encodes it. */
export function encodeBatch(batch: CollectorBatch): string {
  return JSON.stringify(batch)
}

export type DeviceKey = {
  // Raw 32-byte Ed25519 public key, base64url. Registered with the server at pairing.
  publicKey: string
  // PKCS#8 PEM. Belongs in the OS keychain; never sent, never logged.
  privateKeyPem: string
}

export function generateDeviceKey(): DeviceKey {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519")
  const jwk = publicKey.export({ format: "jwk" })
  return {
    publicKey: String(jwk.x),
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  }
}

/** Ed25519 signature over the body's UTF-8 bytes, base64url. */
export function signBody(body: string, privateKeyPem: string): string {
  return sign(null, Buffer.from(body, "utf8"), privateKeyPem).toString("base64url")
}

/** Headers that travel with a batch. The device id is repeated in the body. */
export function batchHeaders(batch: CollectorBatch, signature: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-sanction-device": batch.deviceId,
    "x-sanction-signature": `ed25519=${signature}`,
  }
}
