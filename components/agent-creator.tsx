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

function Copy({ value, label, disabled, start, finish }: {
  value: string
  label: string
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
        aria-label={`Copy ${label}`}
        className="g-btn g-btn-quiet g-btn-sm"
      >
        {status === "pending" ? "copying…" : status === "copied" ? "copied" : "copy"}
      </button>
      <p role="status" aria-live="polite" aria-atomic="true" className="text-xs text-muted-foreground">
        {status === "pending" ? `Copying ${label}…` : status === "copied" ? `${label} copied.` : status === "failed" ? "Copy failed. Select the text and copy it manually." : ""}
      </p>
    </div>
  )
}

export function AgentCreator() {
  const [state, formAction, pending] = useActionState(createAgentAction, initial)
  const [batchState, batchAction, batchPending] = useActionState(createBatchAgentsAction, initialBatch)
  const tracked = useRef<string | null>(null)
  const [mode, setMode] = useState<"single" | "batch">("single")
  const copyLock = useRef(false)
  const [copyPending, setCopyPending] = useState(false)
  const busy = copyPending || pending || batchPending
  const copyProps = {
    disabled: busy,
    start: () => {
      if (copyLock.current || pending || batchPending) return false
      copyLock.current = true
      setCopyPending(true)
      return true
    },
    finish: () => {
      copyLock.current = false
      setCopyPending(false)
    },
  }

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
      <div className="g-seg" role="group" aria-label="How many">
        <button
          type="button"
          disabled={busy}
          onClick={() => { if (!copyLock.current && !pending && !batchPending) setMode("single") }}
          aria-pressed={mode === "single"}
        >
          One agent
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => { if (!copyLock.current && !pending && !batchPending) setMode("batch") }}
          aria-pressed={mode === "batch"}
        >
          Several at once
        </button>
      </div>

      {state.ok && state.agentKey && (
        <div className="space-y-3 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.05] p-4">
          <p className="text-sm font-semibold text-primary">
            {state.agentName} is ready. Copy its key now; it is shown only once.
          </p>
          <div className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5">
            <div className="min-w-0 flex-1">
              <input
                aria-label="Agent key"
                value={state.agentKey}
                readOnly
                spellCheck={false}
                autoComplete="off"
                onFocus={(event) => event.currentTarget.select()}
                className="block w-full min-w-0 bg-transparent font-mono text-base sm:text-xs"
              />
              <p className="text-xs text-muted-foreground">Select the field to copy the full key manually.</p>
            </div>
            <Copy key={state.agentKey} value={state.agentKey} label="agent key" {...copyProps} />
          </div>
          <TestDecision key={state.agentKey} agentKey={state.agentKey} />

          <Disclosure summary="Connect your app — drop-in SDK snippet">
            <ConnectApp agentKey={state.agentKey} />
          </Disclosure>

          <Disclosure summary="Prefer raw HTTP? Copy the curl">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">authorize — one call</span>
              <Copy
                key={state.agentKey}
                label="curl command"
                {...copyProps}
                value={`curl -X POST https://getsanction.com/api/v1/authorize \\\n  -H "x-api-key: ${state.agentKey}" \\\n  -H "content-type: application/json" \\\n  -d '{"action":"purchase","amount_usd":5,"merchant":"OpenAI","category":"software"}'`}
              />
            </div>
            <pre className="mt-1 overflow-x-auto rounded-md border border-border bg-card p-3 text-[11px] leading-relaxed text-muted-foreground">
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
          <form action={formAction} onSubmit={(event) => { if (copyLock.current || pending || batchPending) event.preventDefault() }} className="seat-create">
            <input
              name="name"
              required
              maxLength={64}
              placeholder={state.ok ? "Name another agent" : "Name, for example: nightly-coder"}
              aria-label="Agent name"
              className="g-input"
            />
            <input
              name="holder"
              maxLength={120}
              placeholder="Holder (optional)"
              aria-label="Holder"
              title="Who holds this agent. For the record only; it is never used to sign in."
              className="g-input"
            />
            <input
              name="expires_at"
              type="date"
              aria-label="Expires"
              title="Optional. The key stops working after this day."
              className="g-input"
            />
            <button
              type="submit"
              disabled={busy}
              className="g-btn g-btn-primary"
            >
              {pending ? "Adding…" : state.ok ? "Add another" : "Add agent"}
            </button>
          </form>
          {!state.ok && state.error && <p className="add-pop-error">{state.error}</p>}
        </>
      ) : (
        <>
          {batchState.ok && (batchState.seats?.length ?? 0) > 0 && (
            <div className="space-y-2 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.05] p-4">
              <p className="text-sm font-semibold text-primary">
                Added {batchState.seats!.length} agents ({batchState.templateName}). Copy their keys now; they are shown only once.
              </p>
              <p className="text-xs text-muted-foreground">Select a field to copy the full key manually.</p>
              <div className="max-h-56 overflow-y-auto rounded border border-border bg-muted">
                {batchState.seats!.map((seat, index) => (
                  <div key={seat.id} className="flex items-center gap-2 border-b border-border px-2.5 py-2 last:border-b-0">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs text-foreground">{seat.name}</p>
                      <input
                        aria-label={`Agent key for ${seat.name} (seat ${index + 1})`}
                        value={seat.agentKey}
                        readOnly
                        spellCheck={false}
                        autoComplete="off"
                        onFocus={(event) => event.currentTarget.select()}
                        className="block w-full min-w-0 bg-transparent font-mono text-base text-muted-foreground sm:text-[11px]"
                      />
                    </div>
                    <Copy key={seat.agentKey} value={seat.agentKey} label={`agent key for ${seat.name} (seat ${index + 1})`} {...copyProps} />
                  </div>
                ))}
              </div>
            </div>
          )}

          <form action={batchAction} onSubmit={(event) => { if (copyLock.current || pending || batchPending) event.preventDefault() }} className="seat-form-grid seat-form-grid-5">
            <label>
              Name prefix
              <input
                name="name_prefix"
                required
                maxLength={48}
                placeholder="contractor"
                className="g-input"
              />
            </label>
            <label>
              Holder prefix
              <input
                name="holder_prefix"
                maxLength={100}
                placeholder="Contractor"
                className="g-input"
              />
            </label>
            <label>
              Count
              <input
                name="count"
                type="number"
                min={1}
                max={50}
                defaultValue={5}
                className="g-input"
              />
            </label>
            <label>
              Template
              <select
                name="template_id"
                defaultValue="contractor"
                className="g-input"
              >
                <option value="contractor">contractor</option>
                <option value="sandbox">sandbox</option>
                <option value="prod-runner">prod-runner</option>
              </select>
            </label>
            <label>
              Expires
              <input
                name="expires_at"
                type="date"
                className="g-input"
              />
            </label>
            <div className="seat-form-wide">
              <button
                type="submit"
                disabled={busy}
                className="g-btn g-btn-primary"
              >
                {batchPending ? "Adding agents…" : "Add agents"}
              </button>
            </div>
          </form>
          {!batchState.ok && batchState.error && <p className="add-pop-error">{batchState.error}</p>}
        </>
      )}
    </div>
  )
}
