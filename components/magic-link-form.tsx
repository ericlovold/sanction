"use client"

import { useActionState } from "react"
import { requestMagicLinkAction, type MagicLinkRequestState } from "@/app/login/actions"

const initial: MagicLinkRequestState = { sent: false, error: "" }

export function MagicLinkForm() {
  const [state, formAction, pending] = useActionState(requestMagicLinkAction, initial)

  if (state.sent) {
    return (
      <p
        className="rounded-md border px-4 py-3 text-sm"
        style={{ borderColor: "var(--status-approved)", background: "var(--status-approved-bg)", color: "var(--text-body)" }}
      >
        If that email has a wallet, a sign-in link is on its way. Check your inbox — it&apos;s valid for 15 minutes.
      </p>
    )
  }

  return (
    <form action={formAction} className="space-y-3">
      <label className="block">
        <span className="text-[11px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Email</span>
        <input
          name="email"
          type="email"
          required
          placeholder="you@company.com"
          className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none"
          style={{ borderColor: "var(--paper-3)", background: "var(--surface-card)", color: "var(--text-body)" }}
        />
      </label>
      {state.error && <p className="text-sm text-red-400">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="sn-btn sn-btn-secondary sn-btn-m w-full disabled:opacity-50"
      >
        {pending ? "Sending…" : "Email me a sign-in link"}
      </button>
    </form>
  )
}
