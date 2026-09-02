"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { db } from "@/lib/db"
import { withTenant } from "@/lib/rls"
import { encryptCredentialEnvelope } from "@/lib/credentialCrypto"
import { requireSessionRole } from "@/lib/session"
import { GATEWAY_ONLY_SENTINEL, PROVIDERS } from "@/lib/providers"

const providerIds = z.enum(["anthropic", "openai", "gemini", "perplexity"])

// Connect a provider: vault-encrypt the API key under the reserved
// provider:<id> label. The allow-list carries a sentinel no agent id can match
// (an EMPTY allow-list would mean every agent in the wallet), and /exec refuses
// reserved labels outright — only the gateway reads it, server-side. Reconnecting
// revokes the previous key first (rotation is one action, not two).
export async function connectProviderAction(form: FormData): Promise<void> {
  const wallet = await requireSessionRole("admin")
  if (!wallet) return

  const provider = providerIds.safeParse(form.get("provider"))
  if (!provider.success) return
  const value = z.string().trim().min(8).max(4096).safeParse(form.get("api_key"))
  if (!value.success) return

  const info = PROVIDERS.find((p) => p.id === provider.data)!
  const { blob, keyId } = await encryptCredentialEnvelope(value.data, wallet.id, info.vaultLabel)

  await withTenant(wallet.id, async (tx) => {
    await tx.credentialVault.updateMany({
      where: { walletId: wallet.id, label: info.vaultLabel, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    await tx.credentialVault.create({
      data: {
        walletId: wallet.id,
        label: info.vaultLabel,
        type: "api_key",
        encryptedValue: blob,
        keyId,
        allowedAgentIds: [GATEWAY_ONLY_SENTINEL],
        scopes: [],
        minClearance: 5,
      },
    })
  })

  revalidatePath("/dashboard/providers")
  revalidatePath("/dashboard/credentials")
}

export async function disconnectProviderAction(form: FormData): Promise<void> {
  const wallet = await requireSessionRole("admin")
  if (!wallet) return
  const provider = providerIds.safeParse(form.get("provider"))
  if (!provider.success) return
  const info = PROVIDERS.find((p) => p.id === provider.data)!

  await db.credentialVault.updateMany({
    where: { walletId: wallet.id, label: info.vaultLabel, revokedAt: null },
    data: { revokedAt: new Date() },
  })

  revalidatePath("/dashboard/providers")
  revalidatePath("/dashboard/credentials")
}
