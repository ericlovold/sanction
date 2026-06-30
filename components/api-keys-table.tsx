"use client"

import { useActionState, useState } from "react"
import {
  rotateKeyAction,
  setAgentActiveAction,
  updateLimitsAction,
  type RotateState,
  type LimitsState,
} from "@/app/dashboard/keys/actions"

export type ConsoleAgent = {
  id: string
  name: string
  apiKeyPrefix: string
  isActive: boolean
  createdAt: string
  lastUsedAt: string | null
  dailyTokenBudgetUsd: number | null
  dailySpendBudgetUsd: number | null
  perTransactionMaxUsd: number | null
  escalateOverUsd: number | null
  clearance: number | null
}

function rel(iso: string | null): string {
  if (!iso) return "never"
  const d = Date.now() - new Date(iso).getTime()
  const m = Math.floor(d / 60000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
const dollars = (cents: number | null) => (cents === null ? "" : String(cents / 100))

function Copy({ value }: { value: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(value)
        setDone(true)
        setTimeout(() => setDone(false), 1200)
      }}
      className="shrink-0 rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-400 transition-colors hover:text-zinc-100"
    >
      {done ? "copied" : "copy"}
    </button>
  )
}

const rotateInit: RotateState = { ok: false, error: "" }
const limitsInit: LimitsState = { ok: false, error: "" }

function KeyRow({ agent, editable }: { agent: ConsoleAgent; editable: boolean }) {
  const [rotate, rotateAction, rotating] = useActionState(rotateKeyAction, rotateInit)
  const [limits, limitsFormAction, savingLimits] = useActionState(updateLimitsAction, limitsInit)
  const [open, setOpen] = useState(false)
  const justRotated = rotate.ok && rotate.agentId === agent.id && rotate.newKey

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-zinc-100">{agent.name}</p>
          <p className="font-mono text-xs text-zinc-500">{agent.apiKeyPrefix}••••••••</p>
        </div>
        <div className="flex items-center gap-4 text-xs text-zinc-500">
          <span title={new Date(agent.createdAt).toLocaleString()}>created {rel(agent.createdAt)}</span>
          <span>last used {rel(agent.lastUsedAt)}</span>
          <span className={`rounded-full px-2 py-0.5 ${agent.isActive ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
            {agent.isActive ? "active" : "revoked"}
          </span>
        </div>
      </div>

      {editable && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <form action={rotateAction}>
            <input type="hidden" name="agent_id" value={agent.id} />
            <button type="submit" disabled={rotating} className="rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 transition-colors hover:text-zinc-100 disabled:opacity-50">
              {rotating ? "Rotating…" : "Rotate key"}
            </button>
          </form>
          <form action={setAgentActiveAction}>
            <input type="hidden" name="agent_id" value={agent.id} />
            <input type="hidden" name="active" value={agent.isActive ? "false" : "true"} />
            <button type="submit" className="rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 transition-colors hover:text-zinc-100">
              {agent.isActive ? "Revoke" : "Reactivate"}
            </button>
          </form>
          <button type="button" onClick={() => setOpen((o) => !o)} className="rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 transition-colors hover:text-zinc-100">
            {open ? "Hide limits" : "Edit limits"}
          </button>
        </div>
      )}

      {justRotated && (
        <div className="mt-3 space-y-2 rounded-md border border-emerald-500/30 bg-emerald-500/[0.05] p-3">
          <p className="text-xs font-semibold text-emerald-300">New key — copy it now, it&apos;s shown once.</p>
          <div className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
            <code className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-200">{rotate.newKey}</code>
            <Copy value={rotate.newKey!} />
          </div>
        </div>
      )}

      {editable && open && (
        <form action={limitsFormAction} className="mt-3 space-y-3 rounded-md border border-zinc-800 bg-zinc-950/50 p-3">
          <input type="hidden" name="agent_id" value={agent.id} />
          <p className="text-[11px] uppercase tracking-wide text-zinc-500">Per-agent overrides — blank inherits the wallet policy</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {([
              ["daily_token_budget_usd", "Daily tokens $", agent.dailyTokenBudgetUsd],
              ["daily_spend_budget_usd", "Daily spend $", agent.dailySpendBudgetUsd],
              ["per_transaction_max_usd", "Per-txn max $", agent.perTransactionMaxUsd],
              ["escalate_over_usd", "Escalate over $", agent.escalateOverUsd],
            ] as const).map(([name, label, val]) => (
              <label key={name} className="flex flex-col gap-1 text-[11px] text-zinc-500">
                {label}
                <input
                  name={name}
                  defaultValue={dollars(val)}
                  inputMode="decimal"
                  placeholder="inherit"
                  className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 outline-none focus:border-zinc-600"
                />
              </label>
            ))}
          </div>
          <div className="flex items-end justify-between gap-3">
            <label className="flex flex-col gap-1 text-[11px] text-zinc-500">
              Clearance
              <select name="clearance" defaultValue={agent.clearance ?? 1} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 outline-none focus:border-zinc-600">
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <div className="flex items-center gap-2">
              {limits.ok && <span className="text-[11px] text-emerald-400">saved</span>}
              <button type="submit" disabled={savingLimits} className="rounded-md bg-emerald-500 px-3 py-1 text-xs font-semibold text-zinc-950 transition-colors hover:bg-emerald-400 disabled:opacity-50">
                {savingLimits ? "Saving…" : "Save limits"}
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  )
}

export function ApiKeysTable({ agents, editable }: { agents: ConsoleAgent[]; editable: boolean }) {
  if (agents.length === 0) {
    return <p className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6 text-center text-sm text-zinc-500">No agents yet — create one above to get a key.</p>
  }
  return (
    <div className="space-y-3">
      {agents.map((a) => (
        <KeyRow key={a.id} agent={a} editable={editable} />
      ))}
    </div>
  )
}
