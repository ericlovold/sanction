"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { db } from "@/lib/db"
import { generateApiKey } from "@/lib/apiKey"
import { getSessionWallet } from "@/lib/session"

export type CreateAgentState = { ok: boolean; error: string; agentKey?: string; agentName?: string }

// Create a new agent under the logged-in wallet and return its key once.
// Session-gated (management plane) — same trust model as POST /api/v1/agents.
export async function createAgentAction(_prev: CreateAgentState, form: FormData): Promise<CreateAgentState> {
  const wallet = await getSessionWallet()
  if (!wallet) return { ok: false, error: "Log in to create agents." }

  const parsed = z.string().trim().min(1).max(64).safeParse(form.get("name"))
  if (!parsed.success) return { ok: false, error: "Enter an agent name (1–64 chars)." }

  const key = generateApiKey()
  await db.agent.create({
    data: { walletId: wallet.id, name: parsed.data, apiKeyHash: key.hash, apiKeyPrefix: key.prefix },
  })

  revalidatePath("/dashboard")
  revalidatePath("/dashboard/keys")
  return { ok: true, error: "", agentKey: key.raw, agentName: parsed.data }
}
