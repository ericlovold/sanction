"use client"

import { useActionState, useState } from "react"
import { Activity, CheckCircle2, Clipboard, Clock3, KeyRound, Power, RotateCw, Shield, SlidersHorizontal } from "lucide-react"
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
  pendingApprovals: number
  activeGrants: number
  approvedMonth: number
  deniedMonth: number
  escalatedMonth: number
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
      className="inline-flex shrink-0 items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-400 transition-colors hover:text-zinc-100"
    >
      <Clipboard className="size-3" />
      {done ? "copied" : "copy"}
    </button>
  )
}

const rotateInit: RotateState = { ok: false, error: "" }
const limitsInit: LimitsState = { ok: false, error: "" }

function hasOverrides(agent: ConsoleAgent) {
  return (
    agent.dailyTokenBudgetUsd !== null ||
    agent.dailySpendBudgetUsd !== null ||
    agent.perTransactionMaxUsd !== null ||
    agent.escalateOverUsd !== null
  )
}

function statusClass(value: number, tone: "amber" | "emerald" | "red" | "zinc") {
  if (tone === "amber" && value > 0) return "border-amber-500/25 bg-amber-500/10 text-amber-300"
  if (tone === "emerald" && value > 0) return "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
  if (tone === "red" && value > 0) return "border-red-500/25 bg-red-500/10 text-red-300"
  return "border-zinc-800 bg-zinc-950/60 text-zinc-500"
}

function KeyRow({ agent, editable }: { agent: ConsoleAgent; editable: boolean }) {
  const [rotate, rotateAction, rotating] = useActionState(rotateKeyAction, rotateInit)
  const [limits, limitsFormAction, savingLimits] = useActionState(updateLimitsAction, limitsInit)
  const [open, setOpen] = useState(false)
  const justRotated = rotate.ok && rotate.agentId === agent.id && rotate.newKey
  const overrides = hasOverrides(agent)

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-zinc-100">{agent.name}</p>
            <span className={`rounded-full px-2 py-0.5 text-[11px] ${agent.isActive ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
              {agent.isActive ? "active" : "revoked"}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <span className="inline-flex items-center gap-1 font-mono">
              <KeyRound className="size-3" />
              {agent.apiKeyPrefix}••••••••
            </span>
            <span title={new Date(agent.createdAt).toLocaleString()}>created {rel(agent.createdAt)}</span>
            <span>last used {rel(agent.lastUsedAt)}</span>
          </div>
        </div>
        <div className="grid min-w-[260px] grid-cols-2 gap-2 sm:grid-cols-4 lg:max-w-lg">
          <div className={`rounded-md border px-2 py-1.5 ${statusClass(agent.pendingApprovals, "amber")}`}>
            <p className="text-[10px] uppercase tracking-wide opacity-70">Pending</p>
            <p className="mt-0.5 font-mono text-sm">{agent.pendingApprovals}</p>
          </div>
          <div className={`rounded-md border px-2 py-1.5 ${statusClass(agent.activeGrants, "emerald")}`}>
            <p className="text-[10px] uppercase tracking-wide opacity-70">Grants</p>
            <p className="mt-0.5 font-mono text-sm">{agent.activeGrants}</p>
          </div>
          <div className={`rounded-md border px-2 py-1.5 ${statusClass(agent.deniedMonth, "red")}`}>
            <p className="text-[10px] uppercase tracking-wide opacity-70">Denied</p>
            <p className="mt-0.5 font-mono text-sm">{agent.deniedMonth}</p>
          </div>
          <div className={`rounded-md border px-2 py-1.5 ${statusClass(agent.escalatedMonth, "amber")}`}>
            <p className="text-[10px] uppercase tracking-wide opacity-70">Escalated</p>
            <p className="mt-0.5 font-mono text-sm">{agent.escalatedMonth}</p>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950/60 px-2 py-1 text-zinc-500">
          <Shield className="size-3" />
          clearance {agent.clearance ?? 1}
        </span>
        <span className={`inline-flex items-center gap-1 rounded border px-2 py-1 ${overrides ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300" : "border-zinc-800 bg-zinc-950/60 text-zinc-500"}`}>
          <SlidersHorizontal className="size-3" />
          {overrides ? "custom limits" : "inherits wallet policy"}
        </span>
        <span className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950/60 px-2 py-1 text-zinc-500">
          <Activity className="size-3" />
          {agent.approvedMonth} approved this month
        </span>
      </div>

      {editable && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <form action={rotateAction}>
            <input type="hidden" name="agent_id" value={agent.id} />
            <button type="submit" disabled={rotating} className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 transition-colors hover:text-zinc-100 disabled:opacity-50">
              <RotateCw className="size-3" />
              {rotating ? "Rotating…" : "Rotate key"}
            </button>
          </form>
          <form action={setAgentActiveAction}>
            <input type="hidden" name="agent_id" value={agent.id} />
            <input type="hidden" name="active" value={agent.isActive ? "false" : "true"} />
            <button type="submit" className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 transition-colors hover:text-zinc-100">
              <Power className="size-3" />
              {agent.isActive ? "Revoke" : "Reactivate"}
            </button>
          </form>
          <button type="button" onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 transition-colors hover:text-zinc-100">
            <SlidersHorizontal className="size-3" />
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
              {limits.ok && (
                <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400">
                  <CheckCircle2 className="size-3" />
                  saved
                </span>
              )}
              <button type="submit" disabled={savingLimits} className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500 px-3 py-1 text-xs font-semibold text-zinc-950 transition-colors hover:bg-emerald-400 disabled:opacity-50">
                <Clock3 className="size-3" />
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
    return <p className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6 text-center text-sm text-zinc-500">No agents registered yet.</p>
  }
  return (
    <div className="space-y-3">
      {agents.map((a) => (
        <KeyRow key={a.id} agent={a} editable={editable} />
      ))}
    </div>
  )
}
