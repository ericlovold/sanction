"use server"

import { z } from "zod"
import { db } from "@/lib/db"
import { generateManagementKey, generateApiKey } from "@/lib/apiKey"
import { setSession } from "@/lib/session"

const schema = z.object({
  name: z.string().trim().min(1).max(64),
  email: z.string().trim().email().max(200),
})

export type CreateState =
  | { ok: false; error: string }
  | { ok: true; walletId: string; managementKey: string; agentKey: string; agentName: string }

// Self-serve signup: create a wallet (with default policy + management key) and a
// first agent, returning both keys once. Same trust model as POST /api/v1/wallets
// (intentionally unauthenticated entry point) — the keys are the user's to keep.
export async function createWalletAction(_prev: CreateState, form: FormData): Promise<CreateState> {
  const parsed = schema.safeParse({ name: form.get("name"), email: form.get("email") })
  if (!parsed.success) return { ok: false, error: "Enter a workspace name and a valid email." }

  const { name, email } = parsed.data

  const existing = await db.wallet.findUnique({ where: { ownerEmail: email } })
  if (existing) return { ok: false, error: "A wallet already exists for that email." }

  const mgmt = generateManagementKey()
  const wallet = await db.wallet.create({
    data: {
      name,
      ownerEmail: email,
      mgmtKeyHash: mgmt.hash,
      mgmtKeyPrefix: mgmt.prefix,
      policy: { create: {} },
    },
  })

  const agentName = "default-agent"
  const key = generateApiKey()
  await db.agent.create({
    data: { walletId: wallet.id, name: agentName, apiKeyHash: key.hash, apiKeyPrefix: key.prefix },
  })

  // Log them in immediately so the dashboard is one click away.
  await setSession(mgmt.raw)

  return { ok: true, walletId: wallet.id, managementKey: mgmt.raw, agentKey: key.raw, agentName }
}
