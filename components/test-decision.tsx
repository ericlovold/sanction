"use client"

import { useState } from "react"
import { track } from "@vercel/analytics"

// Authorization-only demo: uses the real /authorize endpoint and records its
// decision. Budget effects depend on enforcement mode; no purchase is executed.
type Decision = { status: string; amount: number; reason?: string }

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
  const light = variant === "light"

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
      {decisions.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {decisions.map((d, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
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
                <span className={light ? "truncate text-xs" : "truncate text-xs text-zinc-600"} style={light ? { color: "var(--text-muted)" } : undefined}>
                  {d.reason}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {ranSmall && (
        <p className={light ? "mt-3 text-xs" : "mt-3 text-xs text-zinc-500"} style={light ? { color: "var(--text-muted)" } : undefined}>
          Your agent&apos;s policy determines whether each request is approved, escalated, or denied. Approval does not execute a purchase.
        </p>
      )}
    </div>
  )
}
