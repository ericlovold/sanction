"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import { track } from "@vercel/analytics"
import { createAgentAction, type CreateAgentState } from "@/app/dashboard/actions"

const initial: CreateAgentState = { ok: false, error: "" }

function Copy({ value, disabled, start, finish }: {
  value: string
  disabled: boolean
  start: () => boolean
  finish: () => void
}) {
  const [status, setStatus] = useState<"idle" | "pending" | "copied" | "failed">("idle")
  async function copy() {
    if (disabled || !start()) return
    setStatus("pending")
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable")
      await navigator.clipboard.writeText(value)
      setStatus("copied")
    } catch {
      setStatus("failed")
    } finally {
      finish()
    }
  }
  return (
    <div>
      <button
        type="button"
        onClick={copy}
        disabled={disabled}
        aria-label="Copy agent key"
        className="g-btn g-btn-quiet g-btn-sm"
      >
        {status === "pending" ? "Copying…" : status === "copied" ? "Copied" : "Copy key"}
      </button>
      <p role="status" aria-live="polite" aria-atomic="true" className="add-pop-status">
        {status === "pending" ? "Copying agent key…" : status === "copied" ? "Agent key copied." : status === "failed" ? "Copy failed. Select the key and copy it manually." : ""}
      </p>
    </div>
  )
}

export function RosterAddAgent({ walletId, groups = [] }: {
  walletId: string
  // Every group an agent can be added to. One group means no picker.
  groups?: Array<{ id: string; name: string }>
}) {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState(createAgentAction, initial)
  const tracked = useRef<string | null>(null)
  const copyLock = useRef(false)
  const [copyPending, setCopyPending] = useState(false)
  // The key that was on screen when the person pressed Done, so a finished
  // agent's key is not shown again the next time the popover opens.
  const [dismissedKey, setDismissedKey] = useState("")

  useEffect(() => {
    if (state.ok && state.agentKey && tracked.current !== state.agentKey) {
      tracked.current = state.agentKey
      track("agent_created")
      setOpen(true)
    }
  }, [state.ok, state.agentKey])

  const keyShowing = Boolean(state.ok && state.agentKey && dismissedKey !== state.agentKey)
  const showing = open || keyShowing

  useEffect(() => {
    if (!showing) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !keyShowing) setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [showing, keyShowing])

  function done() {
    if (copyLock.current) return
    if (state.agentKey) setDismissedKey(state.agentKey)
    setOpen(false)
  }

  return (
    <>
      <button
        type="button"
        data-tour="roster-add"
        aria-expanded={showing}
        aria-controls="add-agent"
        onClick={() => (showing ? done() : setOpen(true))}
        className="g-btn g-btn-primary"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden width="15" height="15">
          <path d="M12 5v14M5 12h14" />
        </svg>
        Add agent
      </button>
      {showing && (
        <div id="add-agent" role="dialog" aria-label="Add agent" className="add-pop g-glass">
          <h2>{keyShowing ? `${state.agentName} is ready` : "Add agent"}</h2>
          <p className="add-pop-note">
            {keyShowing
              ? "Copy its key now. It is shown only once. Paste it into the tool this agent runs in."
              : "Each agent gets its own key, so its requests and spend show up under its own name."}
          </p>
          {keyShowing && state.agentKey && (
            <div className="add-pop-key">
              <input
                aria-label="Agent key"
                value={state.agentKey}
                readOnly
                spellCheck={false}
                autoComplete="off"
                onFocus={(event) => event.currentTarget.select()}
              />
              <div className="add-pop-row" style={{ justifyContent: "space-between", marginTop: 10 }}>
                {/* Opens in a new tab: the key is shown once, so this must not navigate away from it. */}
                <a href="/docs/connect" target="_blank" rel="noreferrer" className="home-link" style={{ fontSize: 13 }}>How to connect a tool</a>
                <Copy
                  key={state.agentKey}
                  value={state.agentKey}
                  disabled={copyPending || pending}
                  start={() => {
                    if (copyLock.current) return false
                    copyLock.current = true
                    setCopyPending(true)
                    return true
                  }}
                  finish={() => {
                    copyLock.current = false
                    setCopyPending(false)
                  }}
                />
              </div>
            </div>
          )}
          <form action={formAction} onSubmit={(event) => { if (copyLock.current) event.preventDefault() }}>
            {groups.length > 1 ? (
              <>
                <label htmlFor="add-agent-group">Group</label>
                <select id="add-agent-group" name="wallet_id" defaultValue={walletId} className="g-input">
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </>
            ) : (
              <input type="hidden" name="wallet_id" value={walletId} />
            )}
            <label htmlFor="add-agent-name">{keyShowing ? "Add another" : "Name"}</label>
            <input
              id="add-agent-name"
              name="name"
              required
              maxLength={64}
              autoFocus={!keyShowing}
              placeholder="For example: Claude Code, Maya's laptop"
              className="g-input"
            />
            {!state.ok && state.error && <p className="add-pop-error">{state.error}</p>}
            <div className="add-pop-row">
              <button type="button" onClick={done} className="g-btn g-btn-quiet">
                {keyShowing ? "Done" : "Cancel"}
              </button>
              <button type="submit" disabled={pending || copyPending} className="g-btn g-btn-primary">
                {pending ? "Adding…" : "Add agent"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
