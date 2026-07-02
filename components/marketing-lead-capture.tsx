"use client"

import { useActionState } from "react"
import { captureLeadAction, type LeadState } from "@/app/actions"

const initial: LeadState = { ok: false, error: "" }

// "Stay in the loop" signup, styled in the gallery-light marketing system.
// Posts to the same captureLeadAction as the rest of the site (stores the lead
// + notifies the founder). Render inside a .sanction subtree so the tokens resolve.
export function MarketingLeadCapture({ source = "landing" }: { source?: string }) {
  const [state, formAction, pending] = useActionState(captureLeadAction, initial)

  if (state.ok) {
    return (
      <p
        style={{
          borderRadius: "var(--radius-m)",
          border: "1px solid var(--status-approved)",
          background: "var(--status-approved-bg)",
          color: "var(--status-approved)",
          padding: "12px 16px",
          fontSize: 14,
          margin: 0,
        }}
      >
        You&apos;re on the list. We&apos;ll send launch updates and early access — no spam, unsubscribe anytime.
      </p>
    )
  }

  return (
    <form action={formAction} style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      <input type="hidden" name="source" value={source} />
      <input
        name="email"
        type="email"
        required
        placeholder="you@company.com"
        aria-label="Email"
        style={{
          flex: "1 1 240px",
          minWidth: 0,
          borderRadius: "var(--radius-m)",
          border: "1px solid var(--line-1)",
          background: "var(--surface-card)",
          color: "var(--text-body)",
          padding: "0 16px",
          height: 48,
          fontSize: 15,
          fontFamily: "var(--font-sans)",
          outline: "none",
        }}
      />
      <button type="submit" disabled={pending} className="sn-btn sn-btn-primary sn-btn-l" style={{ opacity: pending ? 0.6 : 1 }}>
        {pending ? "…" : "Keep me posted"}
      </button>
      {state.error && (
        <p style={{ width: "100%", margin: "4px 0 0", fontSize: 13.5, color: "var(--status-denied)" }}>{state.error}</p>
      )}
    </form>
  )
}
