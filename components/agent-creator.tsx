"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import { track } from "@vercel/analytics"
import { createAgentAction, type CreateAgentState } from "@/app/dashboard/actions"
import { TestDecision } from "@/components/test-decision"
import { ConnectApp } from "@/components/connect-app"
import { Disclosure } from "@/components/disclosure"

const initial: CreateAgentState = { ok: false, error: "" }

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

export function AgentCreator() {
  const [state, formAction, pending] = useActionState(createAgentAction, initial)
  const tracked = useRef<string | null>(null)

  useEffect(() => {
    if (state.ok && state.agentKey && tracked.current !== state.agentKey) {
      tracked.current = state.agentKey
      track("agent_created")
    }
  }, [state.ok, state.agentKey])

  return (
    <div className="space-y-3">
      {state.ok && state.agentKey && (
        <div className="space-y-3 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.05] p-4">
          <p className="text-sm font-semibold text-emerald-300">
            {state.agentName}{" "}created — copy the key now, it&apos;s shown once.
          </p>
          <div className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
            <code className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-200">{state.agentKey}</code>
            <Copy value={state.agentKey} />
          </div>
          <TestDecision agentKey={state.agentKey} />

          <Disclosure summary="Connect your app — drop-in SDK snippet">
            <ConnectApp agentKey={state.agentKey} />
          </Disclosure>

          <Disclosure summary="Prefer raw HTTP? Copy the curl">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wide text-zinc-500">authorize — one call</span>
              <Copy
                value={`curl -X POST https://getsanction.com/api/v1/authorize \\\n  -H "x-api-key: ${state.agentKey}" \\\n  -H "content-type: application/json" \\\n  -d '{"action":"purchase","amount_usd":5,"merchant":"OpenAI","category":"software"}'`}
              />
            </div>
            <pre className="mt-1 overflow-x-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 text-[11px] leading-relaxed text-zinc-300">
              <code>{`curl -X POST https://getsanction.com/api/v1/authorize \\
  -H "x-api-key: ${state.agentKey}" \\
  -H "content-type: application/json" \\
  -d '{"action":"purchase","amount_usd":5,"merchant":"OpenAI","category":"software"}'`}</code>
            </pre>
          </Disclosure>
        </div>
      )}

      <form action={formAction} className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <input
          name="name"
          required
          maxLength={64}
          placeholder={state.ok ? "Name another agent…" : "New agent name — e.g. nightly-coder"}
          className="min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-600"
        />
        <input
          name="holder"
          maxLength={120}
          placeholder="Holder (optional)"
          title="Who holds this seat — audit only, never auth"
          className="min-w-0 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-600 sm:w-44"
        />
        <input
          name="expires_at"
          type="date"
          title="Auto-shutoff: the key fails closed after this day (contractors)"
          className="min-w-0 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-400 outline-none focus:border-zinc-600 sm:w-40"
        />
        <button
          type="submit"
          disabled={pending}
          className="shrink-0 rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-400 disabled:opacity-50"
        >
          {pending ? "Creating…" : state.ok ? "Create another" : "Create agent"}
        </button>
      </form>
      {!state.ok && state.error && <p className="text-sm text-red-400">{state.error}</p>}
    </div>
  )
}
