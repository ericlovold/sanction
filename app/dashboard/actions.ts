"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import { db } from "@/lib/db"
import { generateApiKey } from "@/lib/apiKey"
import { listSessionWallets, requireSessionRole, setActiveWallet } from "@/lib/session"

export type CreateAgentState = { ok: boolean; error: string; agentKey?: string; agentName?: string }
export type BatchSeatResult = { id: string; name: string; holder: string | null; agentKey: string; apiKeyPrefix: string }
export type CreateBatchAgentState = { ok: boolean; error: string; seats?: BatchSeatResult[]; templateName?: string }

type SeatTemplate = {
  dailyTokenBudgetUsd?: number
  dailySpendBudgetUsd?: number
  perTransactionMaxUsd?: number
  escalateOverUsd?: number
  clearance?: number
}

const SEAT_TEMPLATES: Record<string, SeatTemplate> = {
  contractor: {
    dailyTokenBudgetUsd: 10,
    dailySpendBudgetUsd: 20,
    perTransactionMaxUsd: 10,
    escalateOverUsd: 5,
    clearance: 2,
  },
  sandbox: {
    dailyTokenBudgetUsd: 25,
    dailySpendBudgetUsd: 50,
    perTransactionMaxUsd: 25,
    escalateOverUsd: 15,
    clearance: 2,
  },
  "prod-runner": {
    dailyTokenBudgetUsd: 80,
    dailySpendBudgetUsd: 200,
    perTransactionMaxUsd: 75,
    escalateOverUsd: 40,
    clearance: 3,
  },
}

// Create a new agent under the logged-in wallet and return its key once.
// Session-gated (management plane) — same trust model as POST /api/v1/agents.
export async function createAgentAction(_prev: CreateAgentState, form: FormData): Promise<CreateAgentState> {
  const wallet = await requireSessionRole("admin")
  if (!wallet) return { ok: false, error: "Log in to create agents." }

  const parsed = z.string().trim().min(1).max(64).safeParse(form.get("name"))
  if (!parsed.success) return { ok: false, error: "Enter an agent name (1–64 chars)." }

  const holder = z.string().trim().min(1).max(120).safeParse(form.get("holder"))
  // Date input sends YYYY-MM-DD; the seat stays live through that whole day.
  const expiresRaw = String(form.get("expires_at") ?? "").trim()
  const expiresAt = /^\d{4}-\d{2}-\d{2}$/.test(expiresRaw) ? new Date(`${expiresRaw}T23:59:59`) : undefined

  const key = generateApiKey()
  await db.agent.create({
    data: {
      walletId: wallet.id,
      name: parsed.data,
      apiKeyHash: key.hash,
      apiKeyPrefix: key.prefix,
      holder: holder.success ? holder.data : undefined,
      expiresAt,
    },
  })

  revalidatePath("/dashboard")
  revalidatePath("/dashboard/agents")
  return { ok: true, error: "", agentKey: key.raw, agentName: parsed.data }
}

// Batch-create seat agents for single-owner operators. Mirrors /api/v1/agents/batch
// behavior, but session-gated (management key never leaves the server).
export async function createBatchAgentsAction(
  _prev: CreateBatchAgentState,
  form: FormData,
): Promise<CreateBatchAgentState> {
  const wallet = await requireSessionRole("admin")
  if (!wallet) return { ok: false, error: "Log in to create seats." }

  const count = z.coerce.number().int().min(1).max(50).safeParse(form.get("count"))
  if (!count.success) return { ok: false, error: "Seat count must be between 1 and 50." }

  const namePrefix = z.string().trim().min(1).max(48).safeParse(form.get("name_prefix"))
  if (!namePrefix.success) return { ok: false, error: "Enter a seat name prefix (1-48 chars)." }

  const holderPrefixRaw = String(form.get("holder_prefix") ?? "").trim()
  const holderPrefix = holderPrefixRaw ? holderPrefixRaw.slice(0, 100) : ""

  const templateId = String(form.get("template_id") ?? "").trim()
  const template = SEAT_TEMPLATES[templateId] ?? null
  if (!template) return { ok: false, error: "Choose a valid seat template." }

  const expiresRaw = String(form.get("expires_at") ?? "").trim()
  const expiresAt = /^\d{4}-\d{2}-\d{2}$/.test(expiresRaw) ? new Date(`${expiresRaw}T23:59:59`) : undefined

  const roster = Array.from({ length: count.data }, (_, i) => {
    const n = i + 1
    return {
      name: `${namePrefix.data}-${n}`,
      holder: holderPrefix ? `${holderPrefix} ${n}` : null,
    }
  })
  const minted = roster.map((seat) => ({ seat, key: generateApiKey() }))
  const toCents = (value: number | undefined) => (value === undefined ? null : Math.round(value * 100))

  const seats = await db.$transaction(async (tx) => {
    const out: BatchSeatResult[] = []
    for (let i = 0; i < minted.length; i += 1) {
      const { seat, key } = minted[i]
      const agent = await tx.agent.create({
        data: {
          walletId: wallet.id,
          name: seat.name,
          holder: seat.holder,
          apiKeyHash: key.hash,
          apiKeyPrefix: key.prefix,
          expiresAt,
          dailyTokenBudgetUsd: toCents(template.dailyTokenBudgetUsd),
          dailySpendBudgetUsd: toCents(template.dailySpendBudgetUsd),
          perTransactionMaxUsd: toCents(template.perTransactionMaxUsd),
          escalateOverUsd: toCents(template.escalateOverUsd),
        },
      })
      await tx.agentClearance.upsert({
        where: { agentId: agent.id },
        update: { level: template.clearance ?? 1, ...(expiresAt ? { expiresAt } : {}) },
        create: {
          walletId: wallet.id,
          agentId: agent.id,
          level: template.clearance ?? 1,
          ...(expiresAt ? { expiresAt } : {}),
        },
      })
      out.push({
        id: agent.id,
        name: agent.name,
        holder: agent.holder,
        apiKeyPrefix: agent.apiKeyPrefix,
        agentKey: key.raw,
      })
    }
    return out
  })

  revalidatePath("/dashboard")
  revalidatePath("/dashboard/agents")
  return { ok: true, error: "", seats, templateName: templateId }
}

// WALLET-MEMBERS part 2: act as a different wallet this session can already
// reach. Selection, not mutation — a viewer may switch too, so this validates
// against listSessionWallets (ownership or active membership) rather than a
// role floor. Anything off that list is a no-op redirect back to the dashboard.
export async function switchWalletAction(form: FormData) {
  const walletId = String(form.get("wallet_id") ?? "").trim()
  if (walletId) {
    const wallets = await listSessionWallets()
    if (wallets.some((w) => w.id === walletId)) {
      await setActiveWallet(walletId)
    }
  }
  redirect("/dashboard")
}
