"use client"

import { useActionState, useState } from "react"
import { createAgentAction, type CreateAgentState } from "@/app/dashboard/actions"
import { GatewayProviders } from "@/components/gateway-providers"

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

  return (
    <div className="space-y-3">
      {state.ok && state.agentKey && (
        <div className="space-y-3 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.05] p-4">
          <p className="text-sm font-semibold text-emerald-300">
            {state.agentName} created — copy the key now, it&apos;s shown once.
          </p>
          <div className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
            <code className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-200">{state.agentKey}</code>
            <Copy value={state.agentKey} />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wide text-zinc-500">Try it — watch a decision (10s)</span>
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
            <p className="mt-2 text-xs text-zinc-400">
              Returns <span className="font-mono text-emerald-400">approved</span>. Change{" "}
              <span className="font-mono text-zinc-300">amount_usd</span> to <span className="font-mono">40</span> and it
              comes back <span className="font-mono text-amber-400">escalated</span> — refresh to see both decisions in
              the log above.
            </p>
          </div>
          <GatewayProviders agentKey={state.agentKey} />
        </div>
      )}

      <form action={formAction} className="flex flex-col gap-2 sm:flex-row">
        <input
          name="name"
          required
          maxLength={64}
          placeholder="New agent name — e.g. nightly-coder"
          className="min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-600"
        />
        <button
          type="submit"
          disabled={pending}
          className="shrink-0 rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-400 disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create agent"}
        </button>
      </form>
      {!state.ok && state.error && <p className="text-sm text-red-400">{state.error}</p>}
    </div>
  )
}
