"use client"

import { useActionState, useEffect, useMemo, useState } from "react"
import { CheckCircle2, ChevronRight, Clipboard, KeyRound, Power, RotateCw, Search, SlidersHorizontal } from "lucide-react"
import {
  rotateKeyAction,
  setAgentActiveAction,
  updateLimitsAction,
  type RotateState,
  type LimitsState,
} from "@/app/dashboard/keys/actions"
import { agentState } from "@/lib/dashboardCounts"
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
      className="g-btn g-btn-quiet g-btn-sm"
    >
      <Clipboard className="size-3.5" />
      {done ? "Copied" : "Copy key"}
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

function KeyRow({ agent, editable, startOpen, asOf }: { agent: ConsoleAgent; editable: boolean; startOpen: boolean; asOf?: string }) {
  const [rotate, rotateAction, rotating] = useActionState(rotateKeyAction, rotateInit)
  const [limits, limitsFormAction, savingLimits] = useActionState(updateLimitsAction, limitsInit)
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(startOpen)
  const [connectOpen, setConnectOpen] = useState(false)
  const [handoffOpen, setHandoffOpen] = useState(false)
  const justRotated = rotate.ok && rotate.agentId === agent.id && rotate.newKey
  const overrides = hasOverrides(agent)
  const act = agent.activity

  const now = asOf ? new Date(asOf) : new Date()
  const state = agentState(agent, now)
  const expired = agent.expiresAt ? new Date(agent.expiresAt) <= now : false

  return (
    <div id={`seat-${agent.id}`} className="seat">
      {/* Compact row: the list scans quickly; anything non-zero surfaces as a
          chip, and one click opens the agent's full controls. */}
      <button type="button" onClick={() => setExpanded((o) => !o)} aria-expanded={expanded} className="seat-row">
        <ChevronRight className="g-chev" aria-hidden />
        <span className={`g-status seat-dot-${state}`} aria-hidden />
        <span className="seat-name">{agent.name}</span>
        <span className="sr-only">, {state === "active" ? "active" : state === "expired" ? "expired" : "turned off"}</span>
        <span className="seat-holder">{agent.holder ?? ""}</span>
        <span className="seat-group">{agent.walletName}</span>
        <span className="seat-seen">{agent.lastUsedAt ? `Used ${rel(agent.lastUsedAt)}` : "Not used yet"}</span>
        <span className="seat-chips">
          {state !== "active" && <span className={`seat-chip seat-chip-${state}`}>{state === "expired" ? "Expired" : "Off"}</span>}
          {agent.pendingApprovals > 0 && <span className="seat-chip seat-chip-wait">{agent.pendingApprovals} waiting</span>}
          {agent.escalatedMonth > 0 && <span className="seat-chip seat-chip-wait">{agent.escalatedMonth} escalated</span>}
          {agent.deniedMonth > 0 && <span className="seat-chip seat-chip-revoked">{agent.deniedMonth} denied</span>}
          {agent.activeGrants > 0 && (
            <span className="seat-chip seat-chip-live">{agent.activeGrants} grant{agent.activeGrants === 1 ? "" : "s"}</span>
          )}
        </span>
      </button>

      {expanded && (
        <div className="seat-body">
          <p className="seat-meta">
            <span className="seat-key">
              <KeyRound className="size-3.5" aria-hidden />
              {agent.apiKeyPrefix}••••••••
            </span>
            <span title={new Date(agent.createdAt).toLocaleString()}>Created {rel(agent.createdAt)}</span>
            <span>{agent.lastUsedAt ? `Last used ${rel(agent.lastUsedAt)}` : "Not used yet"}</span>
            {agent.expiresAt ? (
              <span style={expired ? { color: "var(--d-wait)" } : undefined} title={new Date(agent.expiresAt).toLocaleString()}>
                {expired ? "Expired" : "Expires"} {relFuture(agent.expiresAt)}
              </span>
            ) : null}
          </p>

          <dl className="seat-facts">
            <div><dt>Waiting on you</dt><dd className={agent.pendingApprovals > 0 ? "seat-fact-wait" : undefined}>{agent.pendingApprovals}</dd></div>
            <div><dt>Active grants</dt><dd>{agent.activeGrants}</dd></div>
            <div><dt>Approved this month</dt><dd>{agent.approvedMonth}</dd></div>
            <div><dt>Denied this month</dt><dd>{agent.deniedMonth}</dd></div>
            <div><dt>Escalated this month</dt><dd>{agent.escalatedMonth}</dd></div>
            <div><dt>Clearance</dt><dd>{agent.clearance ?? 1}</dd></div>
            <div><dt>Limits</dt><dd>{overrides ? "Custom" : "Wallet policy"}</dd></div>
          </dl>

          {act && act.totalCalls > 0 ? (
            <p className="seat-activity">
              {act.totalCalls.toLocaleString()} model call{act.totalCalls === 1 ? "" : "s"}
              {act.topModel ? <>, mostly <span className="seat-mono">{act.topModel}</span></> : null}
              {act.lastTask ? <>. Last task: {act.lastTask}</> : null}
              {act.lastSeen ? <>, {rel(act.lastSeen)}</> : null}
            </p>
          ) : (
            <p className="seat-activity">No model calls yet. Use Connect to put this key into a tool.</p>
          )}

          <div className="seat-actions">
            <button type="button" onClick={() => setConnectOpen((o) => !o)} className="g-btn g-btn-quiet g-btn-sm">
              {connectOpen ? "Hide connect" : "Connect"}
            </button>
            {editable && (
              <>
                <button type="button" onClick={() => setOpen((o) => !o)} className="g-btn g-btn-quiet g-btn-sm">
                  <SlidersHorizontal className="size-3.5" />
                  {open ? "Hide limits" : "Limits and holder"}
                </button>
                <form action={rotateAction} className="seat-inline">
                  <input type="hidden" name="agent_id" value={agent.id} />
                  <input type="hidden" name="change_holder" value={handoffOpen ? "true" : "false"} />
                  {handoffOpen && (
                    <input name="holder" maxLength={120} placeholder={agent.holder ?? "New holder"} aria-label="New holder" className="g-input seat-input-sm" />
                  )}
                  <button type="submit" disabled={rotating} className="g-btn g-btn-quiet g-btn-sm">
                    <RotateCw className="size-3.5" />
                    {rotating ? "Rotating…" : handoffOpen ? "Rotate and hand off" : "Rotate key"}
                  </button>
                </form>
                <button type="button" onClick={() => setHandoffOpen((o) => !o)} className="g-btn g-btn-quiet g-btn-sm">
                  {handoffOpen ? "Cancel hand-off" : "Hand off on rotate"}
                </button>
                <form action={setAgentActiveAction} className="seat-inline seat-push">
                  <input type="hidden" name="agent_id" value={agent.id} />
                  <input type="hidden" name="active" value={agent.isActive ? "false" : "true"} />
                  <button type="submit" className={`g-btn g-btn-quiet g-btn-sm${agent.isActive ? " seat-danger" : ""}`}>
                    <Power className="size-3.5" />
                    {agent.isActive ? "Turn off" : "Turn back on"}
                  </button>
                </form>
              </>
            )}
          </div>

          {connectOpen && <KeyConnect agentKey={justRotated ? rotate.newKey! : "pxy_YOUR_KEY"} hasRealKey={!!justRotated} />}

          {justRotated && (
            <div className="add-pop-key">
              <p className="seat-newkey">New key. Copy it now; it is shown only once.</p>
              <div className="seat-newkey-row">
                <code className="seat-mono seat-newkey-code">{rotate.newKey}</code>
                <Copy value={rotate.newKey!} />
              </div>
            </div>
          )}

          {editable && open && (
            <form action={limitsFormAction} className="seat-form">
              <input type="hidden" name="agent_id" value={agent.id} />
              <p className="seat-form-note">Limits for this agent only. Leave a field blank to use the wallet policy.</p>
              <div className="seat-form-grid">
                {([
                  ["daily_token_budget_usd", "Daily model spend ($)", agent.dailyTokenBudgetUsd],
                  ["daily_spend_budget_usd", "Daily purchases ($)", agent.dailySpendBudgetUsd],
                  ["per_transaction_max_usd", "Largest single purchase ($)", agent.perTransactionMaxUsd],
                  ["escalate_over_usd", "Ask a person above ($)", agent.escalateOverUsd],
                ] as const).map(([name, label, val]) => (
                  <label key={name}>
                    {label}
                    <input name={name} defaultValue={dollars(val)} inputMode="decimal" placeholder="Wallet policy" className="g-input" />
                  </label>
                ))}
                <label>
                  Holder (for the record only)
                  <input name="holder" defaultValue={agent.holder ?? ""} maxLength={120} placeholder="Unassigned" className="g-input" />
                </label>
                <label>
                  Expires (the key stops working after)
                  <input name="expires_at" type="date" defaultValue={agent.expiresAt ? agent.expiresAt.slice(0, 10) : ""} className="g-input" />
                </label>
                <label>
                  Clearance
                  <select name="clearance" defaultValue={agent.clearance ?? 1} className="g-input">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="add-pop-row">
                {!limits.ok && limits.error && <span className="add-pop-error" style={{ margin: 0 }}>{limits.error}</span>}
                {limits.ok && (
                  <span className="seat-saved">
                    <CheckCircle2 className="size-3.5" />
                    Saved
                  </span>
                )}
                <button type="submit" disabled={savingLimits} className="g-btn g-btn-primary g-btn-sm">
                  {savingLimits ? "Saving…" : "Save"}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  )
}

export function ApiKeysTable({ agents, editable, asOf }: { agents: ConsoleAgent[]; editable: boolean; asOf?: string }) {
  const [query, setQuery] = useState("")
  // A link such as /dashboard/agents#seat-<id> (the rows on Home) opens that
  // agent. Read after mount: the hash never reaches the server.
  const [target, setTarget] = useState<string | null>(null)
  useEffect(() => {
    const read = () => {
      const id = window.location.hash.startsWith("#seat-") ? window.location.hash.slice(6) : null
      setTarget(id)
      if (id) document.getElementById(`seat-${id}`)?.scrollIntoView({ block: "center" })
    }
    read()
    window.addEventListener("hashchange", read)
    return () => window.removeEventListener("hashchange", read)
  }, [])

  const needle = query.trim().toLowerCase()
  const shown = useMemo(
    () =>
      needle === ""
        ? agents
        : agents.filter(
            (a) =>
              a.name.toLowerCase().includes(needle) ||
              (a.holder ?? "").toLowerCase().includes(needle) ||
              a.walletName.toLowerCase().includes(needle) ||
              a.apiKeyPrefix.toLowerCase().includes(needle),
          ),
    [agents, needle],
  )

  if (agents.length === 0) {
    return <p className="g-panel g-empty">No agents here yet.</p>
  }
  return (
    <div>
      <label className="agents-search seat-search">
        <span className="sr-only">Search agents</span>
        <Search aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name, person, group or key"
          className="g-input"
        />
      </label>
      <div className="g-panel">
        {shown.length === 0 && <p className="g-empty">No agents match “{query.trim()}”.</p>}
        {shown.map((a) => (
          // Keyed with the target so a hash link re-mounts that one row open.
          <KeyRow key={a.id === target ? `${a.id}-open` : a.id} agent={a} editable={editable} startOpen={a.id === target} asOf={asOf} />
        ))}
      </div>
    </div>
  )
}
