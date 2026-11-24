"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { db } from "@/lib/db"
import { withTenant } from "@/lib/rls"
import { encryptCredentialEnvelope } from "@/lib/credentialCrypto"
import { getSessionMember } from "@/lib/session"
import { hasRole } from "@/lib/roles"
import { fmtUsd } from "@/lib/format"
import { GATEWAY_ONLY_SENTINEL } from "@/lib/providers"
import { adapterFor } from "@/lib/connectors/adapters"
import { ConnectorError, DAY_MS } from "@/lib/connectors/facts"
import { nanosToUsd } from "@/lib/connectors/money"
import { usageProvider, usageVaultLabel } from "@/lib/connectors/registry"
import { syncConnection } from "@/lib/connectors/sync"

export type ConnectState = { ok: boolean; message: string }

const PATH = "/dashboard/ai-spend"
const providerId = z.enum(["cursor", "anthropic", "openai"])
// A key is one unbroken token. Reject anything with whitespace before it gets
// near the provider or the vault.
const apiKey = z.string().trim().min(20).max(500).regex(/^\S+$/)

// Admin floor on every mutation here, like the rest of the dashboard: these
// actions store and use an admin key to someone's AI account.
async function requireAdmin() {
  const member = await getSessionMember()
  if (!member || !hasRole(member.role, "admin")) return null
  return { wallet: member.wallet, email: member.actor.type === "user" ? member.actor.email : member.wallet.ownerEmail }
}

/**
 * Connect (or re-key) a tool. Order matters:
 *   1. Prove the key against the provider. A rejected key is never stored.
 *   2. Encrypt it into the vault under the reserved usage: label.
 *   3. Pull history, so the page has numbers the moment this returns.
 */
export async function connectUsageToolAction(_prev: ConnectState, form: FormData): Promise<ConnectState> {
  const admin = await requireAdmin()
  if (!admin) return { ok: false, message: "Only a wallet admin can connect a tool." }
  const parsedProvider = providerId.safeParse(form.get("provider"))
  const provider = parsedProvider.success ? usageProvider(parsedProvider.data) : undefined
  const adapter = provider ? adapterFor(provider.id) : undefined
  if (!provider || !adapter) return { ok: false, message: "Unknown tool." }
  const key = apiKey.safeParse(form.get("api_key"))
  if (!key.success) return { ok: false, message: `That does not look like an API key. ${provider.keyHint}` }

  const now = new Date()
  try {
    await adapter.probe(key.data, now)
  } catch (error) {
    return { ok: false, message: error instanceof ConnectorError ? error.message : `Could not reach ${provider.name} to check the key. Try again.` }
  }

  const walletId = admin.wallet.id
  // Reuse the wallet's row for this provider (unique on wallet + provider).
  // Clearing syncedThrough makes the next pull re-read the full history window
  // under the same connection, replacing old facts instead of doubling them.
  const connection = await db.usageConnection.upsert({
    where: { walletId_provider: { walletId, provider: provider.id } },
    create: { walletId, provider: provider.id, status: "disconnected", authKind: provider.authKind, connectedByEmail: admin.email, connectedAt: now },
    update: { provider: provider.id },
  })
  const label = usageVaultLabel(provider.id, connection.id)
  const { blob, keyId } = await encryptCredentialEnvelope(key.data, walletId, label)
  await withTenant(walletId, async (tx) => {
    // Lock the connection row before replacing its key. Disconnect and sync
    // acquire the same row before writing any dependent records.
    await tx.usageConnection.update({
      where: { id: connection.id, walletId },
      data: {
        status: "active", statusCode: null, statusDetail: null, connectedByEmail: admin.email,
        connectedAt: now, disconnectedAt: null, syncedThrough: null, lastSuccessAt: null, lastAttemptAt: null,
      },
    })
    // Re-keying deletes the old ciphertext outright; there is no injection
    // history on these rows to preserve.
    await tx.credentialVault.deleteMany({ where: { walletId, label } })
    const credential = await tx.credentialVault.create({
      data: {
        walletId, label, type: "api_key", encryptedValue: blob, keyId,
        // Never injectable: a sentinel no agent id matches, clearance 5, and
        // /exec refuses the reserved usage: prefix outright.
        allowedAgentIds: [GATEWAY_ONLY_SENTINEL], scopes: [], minClearance: 5,
      },
    })
    await tx.usageConnection.update({ where: { id: connection.id, walletId }, data: { credentialId: credential.id } })
  })

  const result = await syncConnection(connection.id, { trigger: "connect_test", actorEmail: admin.email, now })
  revalidatePath(PATH)
  if (!result.ok) {
    return { ok: false, message: `The key was accepted and saved, but the first pull failed: ${result.message}` }
  }

  const since = new Date(now.getTime() - 7 * DAY_MS)
  const week = await withTenant(walletId, (tx) =>
    tx.usageFact.groupBy({
      by: ["rawIdentity"],
      where: { walletId, connectionId: connection.id, bucketStart: { gte: since } },
      _sum: { costNanos: true },
    }),
  )
  const total = week.reduce((sum, row) => sum + (row._sum.costNanos ?? BigInt(0)), BigInt(0))
  const people = week.length === 1 ? "1 person" : `${week.length} people`
  return { ok: true, message: `Connected. Last 7 days: ${fmtUsd(nanosToUsd(total))} across ${people}.` }
}

/**
 * Disconnect: the stored key is deleted immediately (hard delete, no soft
 * retire). Usage history stays unless the admin ticks "delete data too". The
 * pull log is always kept: it is the record of every time the key was used.
 */
export async function disconnectUsageToolAction(form: FormData): Promise<void> {
  const admin = await requireAdmin()
  if (!admin) return
  const id = z.string().min(1).max(64).safeParse(form.get("connection_id"))
  if (!id.success) return
  const walletId = admin.wallet.id
  const connection = await db.usageConnection.findFirst({ where: { id: id.data, walletId } })
  if (!connection) return
  const deleteData = form.get("delete_data") === "on"

  await withTenant(walletId, async (tx) => {
    await tx.usageConnection.update({
      where: { id: connection.id, walletId },
      data: { status: "disconnected", credentialId: null, disconnectedAt: new Date(), statusCode: null, statusDetail: null },
    })
    await tx.credentialVault.deleteMany({ where: { walletId, label: usageVaultLabel(connection.provider, connection.id) } })
    if (deleteData) {
      await tx.usageFact.deleteMany({ where: { walletId, connectionId: connection.id } })
      await tx.usageAlert.deleteMany({ where: { walletId, connectionId: connection.id } })
    }
  })

  revalidatePath(PATH)
}

// Provider reporting changes hourly at best (Cursor asks for at most one poll
// an hour). A manual pull is for "I just fixed something", not a refresh
// button to lean on.
const MANUAL_PULL_GAP_MS = 10 * 60_000

export async function syncUsageToolNowAction(_prev: ConnectState, form: FormData): Promise<ConnectState> {
  const admin = await requireAdmin()
  if (!admin) return { ok: false, message: "Only a wallet admin can pull usage." }
  const id = z.string().min(1).max(64).safeParse(form.get("connection_id"))
  if (!id.success) return { ok: false, message: "Unknown connection." }
  const connection = await db.usageConnection.findFirst({ where: { id: id.data, walletId: admin.wallet.id, status: { not: "disconnected" } } })
  if (!connection) return { ok: false, message: "Unknown connection." }
  if (connection.lastAttemptAt && Date.now() - connection.lastAttemptAt.getTime() < MANUAL_PULL_GAP_MS) {
    return { ok: false, message: "Pulled a few minutes ago. This tool only updates its numbers hourly." }
  }
  const result = await syncConnection(connection.id, { trigger: "manual", actorEmail: admin.email })
  revalidatePath(PATH)
  return result.ok
    ? { ok: true, message: `Pulled. ${result.alertsRaised ? `${result.alertsRaised} new alert${result.alertsRaised === 1 ? "" : "s"}.` : "No new alerts."}` }
    : { ok: false, message: result.message }
}
