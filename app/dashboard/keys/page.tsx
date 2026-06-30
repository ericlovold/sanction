import type { Metadata } from "next"
import Link from "next/link"
import { db } from "@/lib/db"
import { getViewWallet } from "@/lib/session"
import { NoWallet } from "@/components/no-wallet"
import { AgentCreator } from "@/components/agent-creator"
import { ApiKeysTable, type ConsoleAgent } from "@/components/api-keys-table"

export const metadata: Metadata = { title: "API Keys — Sanction" }

export default async function KeysPage() {
  const view = await getViewWallet()
  if (!view) return <NoWallet />

  const rows = await db.agent.findMany({
    where: { walletId: view.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      apiKeyPrefix: true,
      isActive: true,
      createdAt: true,
      lastUsedAt: true,
      dailyTokenBudgetUsd: true,
      dailySpendBudgetUsd: true,
      perTransactionMaxUsd: true,
      escalateOverUsd: true,
      clearance: { select: { level: true } },
    },
  })
  const agents: ConsoleAgent[] = rows.map((a) => ({
    id: a.id,
    name: a.name,
    apiKeyPrefix: a.apiKeyPrefix,
    isActive: a.isActive,
    createdAt: a.createdAt.toISOString(),
    lastUsedAt: a.lastUsedAt ? a.lastUsedAt.toISOString() : null,
    dailyTokenBudgetUsd: a.dailyTokenBudgetUsd,
    dailySpendBudgetUsd: a.dailySpendBudgetUsd,
    perTransactionMaxUsd: a.perTransactionMaxUsd,
    escalateOverUsd: a.escalateOverUsd,
    clearance: a.clearance?.level ?? null,
  }))

  return (
    <>
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight">API Keys</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Create, rotate, and revoke the keys your agents authenticate with. Keys are shown once — store them when issued.
        </p>
      </div>

      {view.isSession ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <AgentCreator />
        </div>
      ) : (
        <p className="text-sm text-zinc-500">
          <Link href="/login" className="text-emerald-400 hover:text-emerald-300">Log in</Link> to create and manage keys.
        </p>
      )}

      <ApiKeysTable agents={agents} editable={view.isSession} />
    </>
  )
}
