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
import { KeyConnect } from "@/components/key-connect"

export type KeyActivity = {
  totalCalls: number
  topModel: string | null
  lastTask: string | null
  lastSeen: string | null
}

export type ConsoleAgent = {
  id: string
  walletId: string
  walletName: string
  name: string
  holder: string | null
  expiresAt: string | null
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
  activity: KeyActivity | null
}

// A seat's effective state: revoked beats expired beats active. Expiry is
// enforced server-side (the key fails closed); this is the operator's view of it.
function seatState(agent: ConsoleAgent): "active" | "expired" | "revoked" {
  if (!agent.isActive) return "revoked"
  if (agent.expiresAt && new Date(agent.expiresAt) <= new Date()) return "expired"
  return "active"
}

function relFuture(iso: string): string {
  const d = new Date(iso).getTime() - Date.now()
  const m = Math.round(Math.abs(d) / 60000)
  const label = m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`
  return d >= 0 ? `in ${label}` : `${label} ago`
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
      className="inline-flex shrink-0 items-center gap-1 rounded border border-input px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
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
  if (tone === "amber" && value > 0) return "border-ochre/25 bg-ochre/10 text-ochre"
  if (tone === "emerald" && value > 0) return "border-signal/25 bg-signal/10 text-signal"
  if (tone === "red" && value > 0) return "border-red-500/25 bg-red-500/10 text-red-300"
  return "border-border bg-muted/40 text-foreground0"
}

function KeyRow({ agent, editable }: { agent: ConsoleAgent; editable: boolean }) {
  const [rotate, rotateAction, rotating] = useActionState(rotateKeyAction, rotateInit)
  const [limits, limitsFormAction, savingLimits] = useActionState(updateLimitsAction, limitsInit)
  const [open, setOpen] = useState(false)
  const [connectOpen, setConnectOpen] = useState(false)
  const [handoffOpen, setHandoffOpen] = useState(false)
  const justRotated = rotate.ok && rotate.agentId === agent.id && rotate.newKey
  const overrides = hasOverrides(agent)
  const act = agent.activity

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-foreground">{agent.name}</p>
            <span className={`rounded-full px-2 py-0.5 text-[11px] ${seatState(agent) === "active" ? "bg-signal/10 text-signal" : seatState(agent) === "expired" ? "bg-ochre/10 text-ochre" : "bg-red-500/10 text-red-400"}`}>
              {seatState(agent)}
            </span>
            {agent.holder ? (
              <span className="rounded-full border border-input px-2 py-0.5 text-[11px] text-muted-foreground" title="Seat holder">
                {agent.holder}
              </span>
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-foreground0">
            <span className="inline-flex items-center gap-1 font-mono">
              <KeyRound className="size-3" />
              {agent.apiKeyPrefix}••••••••
            </span>
            <span className="rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] text-foreground0">
              {agent.walletName}
            </span>
            <span title={new Date(agent.createdAt).toLocaleString()}>created {rel(agent.createdAt)}</span>
            <span>last used {rel(agent.lastUsedAt)}</span>
            {agent.expiresAt ? (
              <span
                className={new Date(agent.expiresAt) <= new Date() ? "text-ochre" : undefined}
                title={new Date(agent.expiresAt).toLocaleString()}
              >
                {new Date(agent.expiresAt) <= new Date() ? "expired" : "expires"} {relFuture(agent.expiresAt)}
              </span>
            ) : null}
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
        <span className="inline-flex items-center gap-1 rounded border border-border bg-muted/40 px-2 py-1 text-foreground0">
          <Shield className="size-3" />
          clearance {agent.clearance ?? 1}
        </span>
        <span className={`inline-flex items-center gap-1 rounded border px-2 py-1 ${overrides ? "border-signal/25 bg-signal/10 text-signal" : "border-border bg-muted/40 text-foreground0"}`}>
          <SlidersHorizontal className="size-3" />
          {overrides ? "custom limits" : "inherits wallet policy"}
        </span>
        <span className="inline-flex items-center gap-1 rounded border border-border bg-muted/40 px-2 py-1 text-foreground0">
          <Activity className="size-3" />
          {agent.approvedMonth} approved this month
        </span>
      </div>

      {act && act.totalCalls > 0 ? (
        <p className="mt-2 text-[11px] text-foreground0">
          seen{" "}
          {act.topModel && <span className="font-mono text-muted-foreground">{act.topModel}</span>}
          {act.topModel && " · "}
          <span className="text-muted-foreground">{act.totalCalls.toLocaleString()}</span> call{act.totalCalls === 1 ? "" : "s"}
          {act.lastTask && (
            <>
              {" · "}task <span className="text-muted-foreground">{act.lastTask}</span>
            </>
          )}
          {act.lastSeen && <> · {rel(act.lastSeen)}</>}
        </p>
      ) : (
        <p className="mt-2 text-[11px] text-muted-foreground">No calls yet — use Connect to wire this key into an agent.</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setConnectOpen((o) => !o)}
          className="rounded-md border border-input px-2.5 py-1 text-xs text-foreground transition-colors hover:text-foreground"
        >
          {connectOpen ? "Hide connect" : "Connect"}
        </button>
        {editable && (
          <>
          <form action={rotateAction} className="flex items-center gap-2">
            <input type="hidden" name="agent_id" value={agent.id} />
            <input type="hidden" name="change_holder" value={handoffOpen ? "true" : "false"} />
            {handoffOpen && (
              <input
                name="holder"
                maxLength={120}
                placeholder={agent.holder ?? "new holder"}
                className="w-36 rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground outline-none focus:border-ring"
              />
            )}
            <button type="submit" disabled={rotating} className="inline-flex items-center gap-1.5 rounded-md border border-input px-2.5 py-1 text-xs text-foreground transition-colors hover:text-foreground disabled:opacity-50">
              <RotateCw className="size-3" />
              {rotating ? "Rotating…" : handoffOpen ? "Rotate + handoff" : "Rotate key"}
            </button>
          </form>
          <button
            type="button"
            onClick={() => setHandoffOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 rounded-md border border-input px-2.5 py-1 text-xs text-foreground transition-colors hover:text-foreground"
          >
            {handoffOpen ? "Cancel handoff" : "Handoff on rotate"}
          </button>
          <form action={setAgentActiveAction}>
            <input type="hidden" name="agent_id" value={agent.id} />
            <input type="hidden" name="active" value={agent.isActive ? "false" : "true"} />
            <button type="submit" className="inline-flex items-center gap-1.5 rounded-md border border-input px-2.5 py-1 text-xs text-foreground transition-colors hover:text-foreground">
              <Power className="size-3" />
              {agent.isActive ? "Revoke" : "Reactivate"}
            </button>
          </form>
          <button type="button" onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1.5 rounded-md border border-input px-2.5 py-1 text-xs text-foreground transition-colors hover:text-foreground">
            <SlidersHorizontal className="size-3" />
            {open ? "Hide seat policy" : "Seat policy"}
          </button>
          </>
        )}
      </div>

      {connectOpen && <KeyConnect agentKey={justRotated ? rotate.newKey! : "pxy_YOUR_KEY"} hasRealKey={!!justRotated} />}

      {justRotated && (
        <div className="mt-3 space-y-2 rounded-md border border-signal/25 bg-signal/[0.05] p-3">
          <p className="text-xs font-semibold text-signal">New key — copy it now, it&apos;s shown once.</p>
          <div className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5">
            <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{rotate.newKey}</code>
            <Copy value={rotate.newKey!} />
          </div>
        </div>
      )}

      {editable && open && (
        <form action={limitsFormAction} className="mt-3 space-y-3 rounded-md border border-border bg-muted/40 p-3">
          <input type="hidden" name="agent_id" value={agent.id} />
          <p className="text-[11px] uppercase tracking-wide text-foreground0">Per-agent overrides — blank inherits the wallet policy</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {([
              ["daily_token_budget_usd", "Daily tokens $", agent.dailyTokenBudgetUsd],
              ["daily_spend_budget_usd", "Daily spend $", agent.dailySpendBudgetUsd],
              ["per_transaction_max_usd", "Per-txn max $", agent.perTransactionMaxUsd],
              ["escalate_over_usd", "Escalate over $", agent.escalateOverUsd],
            ] as const).map(([name, label, val]) => (
              <label key={name} className="flex flex-col gap-1 text-[11px] text-foreground0">
                {label}
                <input
                  name={name}
                  defaultValue={dollars(val)}
                  inputMode="decimal"
                  placeholder="inherit"
                  className="rounded border border-border bg-card px-2 py-1 text-xs text-foreground outline-none focus:border-ring"
                />
              </label>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-[11px] text-foreground0">
              Holder — audit only
              <input
                name="holder"
                defaultValue={agent.holder ?? ""}
                maxLength={120}
                placeholder="unassigned"
                className="rounded border border-border bg-card px-2 py-1 text-xs text-foreground outline-none focus:border-ring"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-foreground0">
              Expires — key fails closed after
              <input
                name="expires_at"
                type="date"
                defaultValue={agent.expiresAt ? agent.expiresAt.slice(0, 10) : ""}
                className="rounded border border-border bg-card px-2 py-1 text-xs text-foreground outline-none focus:border-ring"
              />
            </label>
          </div>
          <div className="flex items-end justify-between gap-3">
            <label className="flex flex-col gap-1 text-[11px] text-foreground0">
              Clearance
              <select name="clearance" defaultValue={agent.clearance ?? 1} className="rounded border border-border bg-card px-2 py-1 text-xs text-foreground outline-none focus:border-ring">
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <div className="flex items-center gap-2">
              {limits.ok && (
                <span className="inline-flex items-center gap-1 text-[11px] text-signal">
                  <CheckCircle2 className="size-3" />
                  saved
                </span>
              )}
              <button type="submit" disabled={savingLimits} className="inline-flex items-center gap-1.5 rounded-md bg-signal px-3 py-1 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50">
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
    return <p className="rounded-lg border border-border bg-card p-6 text-center text-sm text-foreground0">No agents registered yet.</p>
  }
  return (
    <div className="space-y-3">
      {agents.map((a) => (
        <KeyRow key={a.id} agent={a} editable={editable} />
      ))}
    </div>
  )
}
