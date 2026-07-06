"use client"

import { useActionState } from "react"
import { captureLeadAction, type LeadState } from "@/app/actions"

const initial: LeadState = { ok: false, error: "" }

export function LeadCapture({
  source = "landing",
  variant = "dark",
}: {
  source?: string
  // "light" renders with brand.css tokens — only use inside a `.sanction`-scoped
  // page (e.g. /readiness) where the CSS variables resolve.
  variant?: "dark" | "light"
}) {
  const [state, formAction, pending] = useActionState(captureLeadAction, initial)
  const light = variant === "light"

  if (state.ok) {
    return (
      <p
        className={
          light
            ? "rounded-md border px-4 py-3 text-sm"
            : "rounded-md border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300"
        }
        style={light ? { borderColor: "var(--status-approved)", background: "var(--status-approved-bg)", color: "var(--text-body)" } : undefined}
      >
        You&apos;re on the list. We&apos;ll send launch updates and early access — no spam, unsubscribe anytime.
      </p>
    )
  }

  return (
    <form action={formAction} className="flex flex-col gap-2 sm:flex-row">
      <input type="hidden" name="source" value={source} />
      <input
        name="email"
        type="email"
        required
        placeholder="you@company.com"
        aria-label="Email"
        className={
          light
            ? "min-w-0 flex-1 rounded-md border px-3 py-2.5 text-sm outline-none"
            : "min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-zinc-600"
        }
        style={light ? { borderColor: "var(--paper-3)", background: "var(--surface-card)", color: "var(--text-body)" } : undefined}
      />
      <button
        type="submit"
        disabled={pending}
        className={
          light
            ? "sn-btn sn-btn-primary sn-btn-m shrink-0 disabled:opacity-50"
            : "shrink-0 rounded-md bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-400 disabled:opacity-50"
        }
      >
        {pending ? "…" : "Keep me posted"}
      </button>
      {state.error && <p className="mt-1 w-full text-sm text-red-400 sm:order-last">{state.error}</p>}
    </form>
  )
}
