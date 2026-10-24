"use client"

import { useRef, useState } from "react"
import { track } from "@vercel/analytics"

// Authorization-only demo: uses the real /authorize endpoint and records its
// decision. Budget effects depend on enforcement mode; no purchase is executed.
type DecisionStatus = "approved" | "escalated" | "denied"
type Decision = { status: DecisionStatus | "error"; amount: number; reason?: string }

const RECOVERY = "Could not confirm the authorization outcome. Check the authorization log before another attempt."

function readDecision(value: unknown, response: Response): { status: DecisionStatus; reason?: string } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  const { status, reason } = value as Record<string, unknown>
  if (status !== "approved" && status !== "escalated" && status !== "denied") return null
  if (reason !== undefined && typeof reason !== "string") return null
  // A policy denial can use a 4xx response. Server failures are never decisions.
  if (!response.ok && !(status === "denied" && response.status >= 400 && response.status < 500)) return null
  return { status, reason }
}

const BADGE: Record<string, string> = {
  approved: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  escalated: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  denied: "bg-red-500/15 text-red-400 border-red-500/20",
  error: "bg-zinc-500/15 text-zinc-400 border-zinc-700",
}

// Light-mode badge palette from brand.css status tokens (resolve only inside .sanction).
const BADGE_LIGHT: Record<string, React.CSSProperties> = {
  approved: { borderColor: "var(--status-approved)", background: "var(--status-approved-bg)", color: "var(--status-approved)" },
  escalated: { borderColor: "var(--status-escalated)", background: "var(--status-escalated-bg)", color: "var(--status-escalated)" },
  denied: { borderColor: "var(--status-denied)", background: "var(--status-denied-bg)", color: "var(--status-denied)" },
  error: { borderColor: "var(--paper-3)", background: "var(--paper-1)", color: "var(--text-muted)" },
}

// "light" renders with brand.css tokens — only use inside a `.sanction`-scoped page.
export function TestDecision({ agentKey, variant = "dark" }: { agentKey: string; variant?: "dark" | "light" }) {
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [pending, setPending] = useState<number | null>(null)
  const inFlight = useRef(false)
  const light = variant === "light"

  async function run(amount: number) {
    if (inFlight.current) return
    inFlight.current = true
    setPending(amount)
    let decision: Decision = { status: "error", amount, reason: RECOVERY }
    try {
      const res = await fetch("/api/v1/authorize", {
        method: "POST",
        headers: { "x-api-key": agentKey, "content-type": "application/json" },
        body: JSON.stringify({ action: "purchase", amount_usd: amount, merchant: "OpenAI", category: "software" }),
      })
      const result = readDecision(await res.json(), res)
      if (result) decision = { ...result, amount }
    } catch {
      // The request may have reached the server; do not automatically retry it.
    } finally {
      setDecisions((prev) => [...prev, decision])
      setPending(null)
      inFlight.current = false
    }
    try {
      track("test_decision", { amount, status: decision.status })
    } catch {
      // Analytics must not overwrite an authorization outcome.
    }
  }

  const ranSmall = decisions.some((d) => d.amount === 5 && d.status !== "error")

  return (
    <div
      className={light ? "rounded-md border p-4" : "rounded-md border border-zinc-800 bg-zinc-950/50 p-4"}
      style={light ? { borderColor: "var(--paper-3)", background: "var(--surface-card)" } : undefined}
    >
      <p className={light ? "text-sm font-semibold" : "text-sm font-semibold text-emerald-300"} style={light ? { color: "var(--status-approved)" } : undefined}>
        Test an authorization — no purchase
      </p>
      <p className={light ? "mt-1 text-xs" : "mt-1 text-xs text-zinc-400"} style={light ? { color: "var(--text-secondary)" } : undefined}>
        Ask whether your agent may spend a test amount. No money is spent and nothing is purchased.
      </p>
      <p className={light ? "mt-1 text-xs" : "mt-1 text-xs text-zinc-400"} style={light ? { color: "var(--text-secondary)" } : undefined}>
        This creates a real authorization record. In enforce mode, approved amounts count against budgets. In observe mode, tests can still count against parent-wallet limits. Escalated requests may notify an approver.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => run(5)}
          disabled={pending !== null}
          className={
            light
              ? "sn-btn sn-btn-primary sn-btn-m disabled:opacity-50"
              : "rounded-md bg-emerald-500 px-3.5 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-400 disabled:opacity-50"
          }
        >
          {pending === 5 ? "Checking…" : "Test $5 authorization"}
        </button>
        {ranSmall && (
          <button
            type="button"
            onClick={() => run(40)}
            disabled={pending !== null}
            className={
              light
                ? "sn-btn sn-btn-secondary sn-btn-m disabled:opacity-50"
                : "rounded-md border border-zinc-700 px-3.5 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-500 disabled:opacity-50"
            }
          >
            {pending === 40 ? "Checking…" : "Test $40 authorization"}
          </button>
        )}
      </div>
      <div role="log" aria-label="Authorization test results" aria-live="polite" aria-relevant="additions" className="mt-3 space-y-1.5">
        {decisions.map((d, i) => (
          <div key={i} className="flex flex-wrap items-start gap-2 text-sm">
            <span
              className={
                light
                  ? "shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium"
                  : `shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium ${BADGE[d.status] ?? BADGE.error}`
              }
              style={light ? BADGE_LIGHT[d.status] ?? BADGE_LIGHT.error : undefined}
            >
              {d.status}
            </span>
            <span className={light ? "shrink-0 font-mono text-xs" : "shrink-0 font-mono text-xs text-zinc-400"} style={light ? { color: "var(--text-secondary)" } : undefined}>
              ${d.amount} authorization test
            </span>
            {d.reason && (
              <span className={light ? "min-w-0 basis-full break-words text-xs" : "min-w-0 basis-full break-words text-xs text-zinc-400"} style={light ? { color: "var(--text-muted)" } : undefined}>
                {d.reason}
              </span>
            )}
          </div>
        ))}
      </div>
      {ranSmall && (
        <p className={light ? "mt-3 text-xs" : "mt-3 text-xs text-zinc-500"} style={light ? { color: "var(--text-muted)" } : undefined}>
          Your agent&apos;s policy determines whether each request is approved, escalated, or denied. Approval does not execute a purchase.
        </p>
      )}
    </div>
  )
}
