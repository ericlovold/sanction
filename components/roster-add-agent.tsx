"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import { track } from "@vercel/analytics"
import { createAgentAction, type CreateAgentState } from "@/app/dashboard/actions"

const initial: CreateAgentState = { ok: false, error: "" }

function Copy({ value }: { value: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(value)
        setDone(true)
        setTimeout(() => setDone(false), 1200)
      }}
      className="shrink-0 border border-[var(--roster-rule)] px-2 py-1 text-[11px] text-[var(--roster-fog)] hover:text-[var(--roster-signal)]"
    >
      {done ? "copied" : "copy"}
    </button>
  )
}

export function RosterAddAgent({ walletId }: { walletId: string }) {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState(createAgentAction, initial)
  const tracked = useRef<string | null>(null)

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
          <div className="flex items-center gap-2 border border-[var(--roster-rule)] px-2.5 py-1.5">
            <code className="min-w-0 flex-1 truncate font-mono text-xs">{state.agentKey}</code>
            <Copy value={state.agentKey} />
          </div>
        </div>
      )}
      <form action={formAction} className="flex flex-col gap-2 sm:flex-row">
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
          disabled={pending}
          className="shrink-0 bg-[var(--roster-brass)] px-4 py-2 text-sm font-semibold text-[var(--roster-ink)] disabled:opacity-50"
        >
          {pending ? "Creating…" : state.ok ? "Create another" : "Create"}
        </button>
      </form>
      {!state.ok && state.error && <p className="mt-2 text-sm text-red-400">{state.error}</p>}
    </div>
  )
}
