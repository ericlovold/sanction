// The sync shell: everything with side effects for one connection pull.
// Reads the credential, calls the provider, replaces the pulled window of
// facts atomically, runs the pure guardrails over the result, persists and
// notifies. The decisions (normalizing, alerting) are pure functions next
// door; this file only moves data.

import { db } from "@/lib/db"
import { scopeTenant, withTenant } from "@/lib/rls"
import { decryptCredentialEnvelope } from "@/lib/credentialCrypto"
import { sendUsageAlertEmail } from "@/lib/email"
import { logger } from "@/lib/log"
import { adapterFor } from "./adapters"
import { ConnectorError, DAY_MS, HOUR_MS, factDedupeKey, hourStart, needsReconnect } from "./facts"
import { DEFAULT_THRESHOLDS, evaluateGuardrails, type AlertInput, type GuardFact } from "./guardrails"
import type { FetchDeps } from "./pace"
import { usageProvider } from "./registry"

const log = logger("usage-sync")

export type SyncTrigger = "cron" | "connect_test" | "manual"

export type SyncResult =
  | { ok: true; factsWritten: number; alertsRaised: number; windowStart: Date; windowEnd: Date }
  | { ok: false; code: string; message: string }

export type SyncOptions = {
  trigger: SyncTrigger
  actorEmail?: string | null
  now?: Date
  http?: FetchDeps
}

// An alert about something older than this is recorded but not emailed: the
// first pull reads 30 days, and nobody needs a page about three weeks ago.
const NOTIFY_WITHIN_MS = 48 * HOUR_MS

/**
 * Pull one connection up to `now`. Never throws: every outcome, including a
 * crash, is written to UsageSyncRun (the credential-use audit trail) and to
 * the connection's status, and returned.
 */
export async function syncConnection(connectionId: string, opts: SyncOptions): Promise<SyncResult> {
  const now = opts.now ?? new Date()
  const connection = await db.usageConnection.findUnique({ where: { id: connectionId } })
  if (!connection || connection.status === "disconnected") {
    return { ok: false, code: "missing_credential", message: "This connection no longer exists." }
  }
  const provider = usageProvider(connection.provider)
  const adapter = adapterFor(connection.provider)
  if (!provider || !adapter) return { ok: false, code: "unexpected_response", message: "This connector is not available." }
  const walletId = connection.walletId

  // Whole hours only, so a replaced window never cuts an hourly bucket in two.
  const windowStartMs = connection.syncedThrough
    ? hourStart(connection.syncedThrough.getTime() - provider.overlapHours * HOUR_MS)
    : hourStart(now.getTime() - provider.backfillDays * DAY_MS)
  const windowStart = new Date(windowStartMs)
  let httpCalls = 0

  try {
    const credential = connection.credentialId
      ? await withTenant(walletId, (tx) =>
          tx.credentialVault.findFirst({ where: { id: connection.credentialId!, walletId, revokedAt: null } }),
        )
      : null
    if (!credential) throw new ConnectorError("missing_credential", "The stored key for this connection is gone. Connect it again.")
    const apiKey = await decryptCredentialEnvelope(credential)

    const pulled = await adapter.pull(apiKey, { startMs: windowStartMs, endMs: now.getTime() }, opts.http)
    httpCalls = pulled.httpCalls
    // The provider's own "data as of" when it gives one, else our pull time.
    const sourceRefreshedAt = pulled.refreshedAt ?? now
    const replaceFrom = new Date(pulled.fromMs)

    const { factsWritten, fresh } = await db.$transaction(
      async (tx) => {
        await scopeTenant(tx, walletId)
        // One pull per connection at a time: a cron run and a "Sync now" click
        // must not both replace the same window.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`usage-sync:${connectionId}`}))`

        // Replace, not merge: the window is re-read from the provider in full,
        // so deleting it and writing what came back is idempotent and also
        // picks up rows the provider revised or withdrew.
        await tx.usageFact.deleteMany({ where: { walletId, connectionId, bucketStart: { gte: replaceFrom } } })
        for (let i = 0; i < pulled.facts.length; i += 1000) {
          await tx.usageFact.createMany({
            data: pulled.facts.slice(i, i + 1000).map((f) => ({
              ...f,
              walletId,
              connectionId,
              sourceRefreshedAt,
              dedupeKey: factDedupeKey(connectionId, f),
            })),
          })
        }

        // Guardrails see the new window plus the history baselines need.
        const baselineFrom = new Date(pulled.fromMs - DEFAULT_THRESHOLDS.baselineDays * DAY_MS)
        const rows = await tx.usageFact.findMany({
          where: { walletId, connectionId, bucketStart: { gte: baselineFrom } },
          select: { provider: true, rawIdentity: true, identityType: true, model: true, sessionRef: true, automationRef: true, headless: true, bucketStart: true, bucketEnd: true, costNanos: true, costBasis: true },
        })
        const guardFacts: GuardFact[] = rows.map((r) => ({
          provider: r.provider,
          rawIdentity: r.rawIdentity,
          model: r.model,
          sessionRef: r.sessionRef,
          automationRef: r.automationRef,
          headless: r.headless,
          human: r.identityType === "user",
          hourly: r.bucketEnd.getTime() - r.bucketStart.getTime() === HOUR_MS,
          bucketStartMs: r.bucketStart.getTime(),
          costNanos: r.costNanos,
          billed: r.costBasis === "billed",
        }))
        const alerts = evaluateGuardrails(guardFacts, pulled.fromMs)
        const known = new Set(
          (await tx.usageAlert.findMany({ where: { walletId, dedupeKey: { in: alerts.map((a) => a.dedupeKey) } }, select: { dedupeKey: true } })).map((a) => a.dedupeKey),
        )
        const fresh = alerts.filter((a) => !known.has(a.dedupeKey))
        if (fresh.length) {
          await tx.usageAlert.createMany({
            data: fresh.map((a) => ({ ...a, walletId, connectionId, evidence: a.evidence })),
            skipDuplicates: true,
          })
        }
        return { factsWritten: pulled.facts.length, fresh }
      },
      { timeout: 60_000, maxWait: 15_000 },
    )

    await db.usageConnection.update({
      where: { id: connectionId },
      data: { status: "active", statusCode: null, statusDetail: null, lastAttemptAt: now, lastSuccessAt: now, syncedThrough: now },
    })
    await record(walletId, connectionId, opts, {
      endpoint: adapter.endpoint, windowStart, windowEnd: now, status: "ok", httpCalls, factsWritten, alertsRaised: fresh.length,
    })
    await notify(walletId, connectionId, fresh, now)
    return { ok: true, factsWritten, alertsRaised: fresh.length, windowStart, windowEnd: now }
  } catch (error) {
    const known = error instanceof ConnectorError
    const code = known ? error.kind : "provider_unavailable"
    const message = known ? error.message : "The pull failed unexpectedly. Sanction will try again on the next hourly pull."
    // Never log the error object for a connector failure path that could carry
    // request details; the code and connection id are enough to find the run.
    log.error("usage sync failed", { connectionId, provider: connection.provider, code, unexpected: !known, name: known ? undefined : (error as Error)?.name })
    await db.usageConnection
      .update({ where: { id: connectionId }, data: { status: "error", statusCode: code, statusDetail: message, lastAttemptAt: now } })
      .catch(() => undefined)
    await record(walletId, connectionId, opts, {
      endpoint: adapter.endpoint, windowStart, windowEnd: now, status: "failed", errorCode: code, httpCalls, factsWritten: 0, alertsRaised: 0,
    }).catch(() => undefined)
    return { ok: false, code, message }
  }
}

function record(
  walletId: string,
  connectionId: string,
  opts: SyncOptions,
  run: { endpoint: string; windowStart: Date; windowEnd: Date; status: string; errorCode?: string; httpCalls: number; factsWritten: number; alertsRaised: number },
) {
  return withTenant(walletId, (tx) =>
    tx.usageSyncRun.create({
      data: { walletId, connectionId, trigger: opts.trigger, actorEmail: opts.actorEmail ?? null, finishedAt: new Date(), ...run },
    }),
  )
}

// Best effort: a failed email must not fail a pull whose data is already
// stored. Alerts that could not be sent keep notifiedAt null and stay visible
// in the dashboard either way.
async function notify(walletId: string, connectionId: string, alerts: AlertInput[], now: Date) {
  const recent = alerts.filter((a) => now.getTime() - a.windowEnd.getTime() <= NOTIFY_WITHIN_MS)
  if (!recent.length) return
  try {
    const wallet = await db.wallet.findUnique({ where: { id: walletId }, select: { ownerEmail: true, name: true } })
    if (!wallet) return
    await sendUsageAlertEmail(wallet.ownerEmail, { walletName: wallet.name, alerts: recent })
    await withTenant(walletId, (tx) =>
      tx.usageAlert.updateMany({ where: { walletId, dedupeKey: { in: recent.map((a) => a.dedupeKey) } }, data: { notifiedAt: new Date() } }),
    )
  } catch {
    log.error("usage alert email failed", { connectionId, alerts: recent.length })
  }
}

/** Connections the hourly poller should pull, least recently attempted first. */
export async function dueConnections(limit = 50) {
  const rows = await db.usageConnection.findMany({
    where: { status: { in: ["active", "error"] }, credentialId: { not: null } },
    orderBy: [{ lastAttemptAt: { sort: "asc", nulls: "first" } }],
    select: { id: true, statusCode: true },
    take: limit * 2,
  })
  return rows.filter((r) => !needsReconnect(r.statusCode)).slice(0, limit).map((r) => r.id)
}
