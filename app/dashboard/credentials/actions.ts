"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { encryptCredentialEnvelope } from "@/lib/credentialCrypto"
import { withTenant } from "@/lib/rls"
import { requireSessionRole } from "@/lib/session"

const credentialType = z.enum(["api_key", "oauth_token", "certificate", "license", "password"])

const parseCsv = (value: FormDataEntryValue | null) =>
  String(value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

export async function createCredentialAction(form: FormData): Promise<void> {
  const wallet = await requireSessionRole("admin")
  if (!wallet) return

  const label = z.string().trim().min(1).max(64).safeParse(form.get("label"))
  if (!label.success) return
  const type = credentialType.safeParse(form.get("type"))
  if (!type.success) return
  const value = z.string().trim().min(1).safeParse(form.get("value"))
  if (!value.success) return
  const minClearance = z.coerce.number().int().min(1).max(5).safeParse(form.get("min_clearance"))
  if (!minClearance.success) return

  const expiresRaw = String(form.get("expires_at") ?? "").trim()
  const expiresAt = /^\d{4}-\d{2}-\d{2}$/.test(expiresRaw) ? new Date(`${expiresRaw}T23:59:59`) : undefined
  const allowedAgentIds = parseCsv(form.get("allowed_agent_ids"))
  const scopes = parseCsv(form.get("scopes"))

  const { blob, keyId } = await encryptCredentialEnvelope(value.data, wallet.id, label.data)
  await withTenant(wallet.id, (tx) =>
    tx.credentialVault.create({
      data: {
        walletId: wallet.id,
        label: label.data,
        type: type.data,
        encryptedValue: blob,
        keyId,
        allowedAgentIds,
        scopes,
        minClearance: minClearance.data,
        expiresAt,
      },
    }),
  )

  revalidatePath("/dashboard/credentials")
}

export async function updateCredentialAccessAction(form: FormData): Promise<void> {
  const wallet = await requireSessionRole("admin")
  if (!wallet) return
  const id = String(form.get("id") ?? "")
  if (!id) return
  const minClearance = z.coerce.number().int().min(1).max(5).safeParse(form.get("min_clearance"))
  if (!minClearance.success) return
  const expiresRaw = String(form.get("expires_at") ?? "").trim()
  const expiresAt = /^\d{4}-\d{2}-\d{2}$/.test(expiresRaw) ? new Date(`${expiresRaw}T23:59:59`) : null

  const updated = await withTenant(wallet.id, async (tx) => {
    const row = await tx.credentialVault.findUnique({ where: { id } })
    if (!row || row.walletId !== wallet.id) return false
    await tx.credentialVault.update({
      where: { id },
      data: {
        allowedAgentIds: parseCsv(form.get("allowed_agent_ids")),
        scopes: parseCsv(form.get("scopes")),
        minClearance: minClearance.data,
        expiresAt,
      },
    })
    return true
  })
  if (!updated) return

  revalidatePath("/dashboard/credentials")
}

export async function revokeCredentialAction(form: FormData): Promise<void> {
  const wallet = await requireSessionRole("admin")
  if (!wallet) return
  const id = String(form.get("id") ?? "")
  if (!id) return
  await withTenant(wallet.id, async (tx) => {
    const row = await tx.credentialVault.findUnique({ where: { id } })
    if (!row || row.walletId !== wallet.id) return
    await tx.credentialVault.update({ where: { id }, data: { revokedAt: new Date() } })
  })
  revalidatePath("/dashboard/credentials")
}
