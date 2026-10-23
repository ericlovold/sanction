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
    <div className="space-y-1">
      <button
        type="button"
        onClick={copy}
        disabled={disabled}
        aria-label="Copy agent key"
        className="shrink-0 border border-[var(--roster-rule)] px-2 py-1 text-[11px] text-[var(--roster-fog)] hover:text-[var(--roster-signal)] disabled:opacity-50"
      >
        {status === "pending" ? "copying…" : status === "copied" ? "copied" : "copy"}
      </button>
      <p role="status" aria-live="polite" aria-atomic="true" className="text-xs text-[var(--roster-fog)]">
        {status === "pending" ? "Copying agent key…" : status === "copied" ? "Agent key copied." : status === "failed" ? "Copy failed. Select the key and copy it manually." : ""}
      </p>
    </div>
  )
}

export function RosterAddAgent({ walletId }: { walletId: string }) {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState(createAgentAction, initial)
  const tracked = useRef<string | null>(null)
  const copyLock = useRef(false)
  const [copyPending, setCopyPending] = useState(false)

  useEffect(() => {
    if (state.ok && state.agentKey && tracked.current !== state.agentKey) {
      tracked.current = state.agentKey
      track("agent_created")
      setOpen(true)
    }
  }, [state.ok, state.agentKey])

  if (!open && !state.ok) {
    return (
      <button
        type="button"
        data-tour="roster-add"
        onClick={() => setOpen(true)}
        className="flex min-h-[88px] w-full flex-col justify-center border border-dashed border-[var(--roster-rule)] px-4 py-3 text-left transition-colors hover:border-[var(--roster-brass)]"
      >
        <span className="text-sm font-medium text-[var(--roster-signal)]">+ Agent</span>
        <span className="mt-1 text-xs text-[var(--roster-fog)]">Name it. Copy the key once.</span>
      </button>
    )
  }

  return (
    <div className="border border-[var(--roster-rule)] bg-[var(--roster-paper)] px-4 py-3">
      {state.ok && state.agentKey && (
        <div className="mb-3 space-y-2">
          <p className="text-sm text-[var(--roster-signal)]">
            {state.agentName} created — copy the key now. It is shown once.
          </p>
          <div className="space-y-2 border border-[var(--roster-rule)] px-2.5 py-1.5">
            <input
              aria-label="Agent key"
              value={state.agentKey}
              readOnly
              spellCheck={false}
              autoComplete="off"
              onFocus={(event) => event.currentTarget.select()}
              className="block w-full min-w-0 bg-transparent font-mono text-base sm:text-xs"
            />
            <p className="text-xs text-[var(--roster-fog)]">Select the field to copy the full key manually.</p>
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
      <form action={formAction} onSubmit={(event) => { if (copyLock.current) event.preventDefault() }} className="flex flex-col gap-2 sm:flex-row">
        <input type="hidden" name="wallet_id" value={walletId} />
        <input
          name="name"
          required
          maxLength={64}
          autoFocus={!state.ok}
          placeholder={state.ok ? "Name another agent" : "Agent name"}
          className="min-w-0 flex-1 border border-[var(--roster-rule)] bg-[var(--roster-ink)] px-3 py-2 text-sm text-[var(--roster-signal)] outline-none focus:border-[var(--roster-brass)]"
        />
        <button
          type="submit"
          disabled={pending || copyPending}
          className="shrink-0 bg-[var(--roster-brass)] px-4 py-2 text-sm font-semibold text-[var(--roster-ink)] disabled:opacity-50"
        >
          {pending ? "Creating…" : state.ok ? "Create another" : "Create"}
        </button>
      </form>
      {!state.ok && state.error && <p className="mt-2 text-sm text-red-400">{state.error}</p>}
    </div>
  )
}
