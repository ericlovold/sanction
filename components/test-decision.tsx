"use client"

import { useState } from "react"
import { track } from "@vercel/analytics"

// The zero-setup first win: click a button, watch Sanction decide a real spend
// request in the browser. Same /authorize call the agent would make — no curl,
// no provider key, no terminal. The decision persists, so it lands in the log too.
type Decision = { status: string; amount: number; reason?: string }

const BADGE: Record<string, string> = {
  approved: "bg-signal/10 text-signal border-signal/25",
  escalated: "bg-ochre/10 text-ochre border-ochre/25",
  denied: "bg-red-500/15 text-red-400 border-red-500/20",
  error: "bg-muted text-muted-foreground border-input",
}

export function TestDecision({ agentKey }: { agentKey: string }) {
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [pending, setPending] = useState<number | null>(null)

  async function run(amount: number) {
    setPending(amount)
    try {
      const res = await fetch("/api/v1/authorize", {
        method: "POST",
        headers: { "x-api-key": agentKey, "content-type": "application/json" },
        body: JSON.stringify({ action: "purchase", amount_usd: amount, merchant: "OpenAI", category: "software" }),
      })
      const d = await res.json().catch(() => ({}))
      const status = d.status ?? "error"
      track("test_decision", { amount, status })
      setDecisions((prev) => [...prev, { status, amount, reason: d.reason }])
    } catch {
      setDecisions((prev) => [...prev, { status: "error", amount, reason: "Network error" }])
    } finally {
      setPending(null)
    }
  }

  const ranSmall = decisions.some((d) => d.amount === 5)

  return (
    <div className="rounded-md border border-border bg-muted/40 p-4">
      <p className="text-sm font-semibold text-signal">See it work — no setup</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Send a real spend request through your agent. Sanction decides and logs it — watch it happen.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => run(5)}
          disabled={pending !== null}
          className="rounded-md bg-signal px-3.5 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {pending === 5 ? "Running…" : "Run a $5 purchase"}
        </button>
        {ranSmall && (
          <button
            type="button"
            onClick={() => run(40)}
            disabled={pending !== null}
            className="rounded-md border border-input px-3.5 py-2 text-sm font-medium text-foreground transition-colors hover:border-ring/50 disabled:opacity-50"
          >
            {pending === 40 ? "Running…" : "Now try a $40 purchase"}
          </button>
        )}
      </div>
      {decisions.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {decisions.map((d, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium ${BADGE[d.status] ?? BADGE.error}`}>{d.status}</span>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">${d.amount} → OpenAI</span>
              {d.reason && <span className="truncate text-xs text-muted-foreground">{d.reason}</span>}
            </div>
          ))}
        </div>
      )}
      {ranSmall && (
        <p className="mt-3 text-xs text-foreground0">
          That&apos;s the engine: small spend clears, big spend escalates to you. Both are now in your authorization log.
        </p>
      )}
    </div>
  )
}
