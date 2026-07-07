"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import { track } from "@vercel/analytics"
import {
  createAgentAction,
  createBatchAgentsAction,
  type CreateAgentState,
  type CreateBatchAgentState,
} from "@/app/dashboard/actions"
import { TestDecision } from "@/components/test-decision"
import { ConnectApp } from "@/components/connect-app"
import { Disclosure } from "@/components/disclosure"

const initial: CreateAgentState = { ok: false, error: "" }
const initialBatch: CreateBatchAgentState = { ok: false, error: "" }

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
  const [batchState, batchAction, batchPending] = useActionState(createBatchAgentsAction, initialBatch)
  const tracked = useRef<string | null>(null)
  const [mode, setMode] = useState<"single" | "batch">("single")

  useEffect(() => {
    if (state.ok && state.agentKey && tracked.current !== state.agentKey) {
      tracked.current = state.agentKey
      track("agent_created")
    }
  }, [state.ok, state.agentKey])

  useEffect(() => {
    if (batchState.ok && batchState.seats?.length) track("seat_batch_created")
  }, [batchState.ok, batchState.seats])

  return (
    <div className="space-y-3">
      <div className="inline-flex rounded-md border border-zinc-800 bg-zinc-950/40 p-1 text-xs">
        <button
          type="button"
          onClick={() => setMode("single")}
          className={`rounded px-2 py-1 transition-colors ${mode === "single" ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
        >
          Single seat
        </button>
        <button
          type="button"
          onClick={() => setMode("batch")}
          className={`rounded px-2 py-1 transition-colors ${mode === "batch" ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
        >
          Batch seats
        </button>
      </div>

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

      {mode === "single" ? (
        <>
          <form action={formAction} className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <input
              name="name"
              required
              maxLength={64}
              placeholder={state.ok ? "Name another seat…" : "New seat name — e.g. nightly-coder"}
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
              {pending ? "Creating…" : state.ok ? "Create another" : "Create seat"}
            </button>
          </form>
          {!state.ok && state.error && <p className="text-sm text-red-400">{state.error}</p>}
        </>
      ) : (
        <>
          {batchState.ok && (batchState.seats?.length ?? 0) > 0 && (
            <div className="space-y-2 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.05] p-4">
              <p className="text-sm font-semibold text-emerald-300">
                Created {batchState.seats!.length} seats ({batchState.templateName}) — copy keys now, they are shown once.
              </p>
              <div className="max-h-56 overflow-y-auto rounded border border-zinc-800 bg-zinc-950/60">
                {batchState.seats!.map((seat) => (
                  <div key={seat.id} className="flex items-center gap-2 border-b border-zinc-800 px-2.5 py-2 last:border-b-0">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs text-zinc-200">{seat.name}</p>
                      <code className="truncate font-mono text-[11px] text-zinc-400">{seat.agentKey}</code>
                    </div>
                    <Copy value={seat.agentKey} />
                  </div>
                ))}
              </div>
            </div>
          )}

          <form action={batchAction} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <label className="flex flex-col gap-1 text-[11px] text-zinc-500">
              Name prefix
              <input
                name="name_prefix"
                required
                maxLength={48}
                placeholder="contractor"
                className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-600"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-zinc-500">
              Holder prefix
              <input
                name="holder_prefix"
                maxLength={100}
                placeholder="Contractor"
                className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-600"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-zinc-500">
              Count
              <input
                name="count"
                type="number"
                min={1}
                max={50}
                defaultValue={5}
                className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-600"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-zinc-500">
              Template
              <select
                name="template_id"
                defaultValue="contractor"
                className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-600"
              >
                <option value="contractor">contractor</option>
                <option value="sandbox">sandbox</option>
                <option value="prod-runner">prod-runner</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-zinc-500">
              Expires
              <input
                name="expires_at"
                type="date"
                className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-400 outline-none focus:border-zinc-600"
              />
            </label>
            <div className="sm:col-span-2 lg:col-span-5">
              <button
                type="submit"
                disabled={batchPending}
                className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-400 disabled:opacity-50"
              >
                {batchPending ? "Creating seats…" : "Create seat batch"}
              </button>
            </div>
          </form>
          {!batchState.ok && batchState.error && <p className="text-sm text-red-400">{batchState.error}</p>}
        </>
      )}
    </div>
  )
}
