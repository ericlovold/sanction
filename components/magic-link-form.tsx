"use client"

import { useActionState, useState } from "react"
import { requestMagicLinkAction, type MagicLinkRequestState } from "@/app/login/actions"

const initial: MagicLinkRequestState = { sent: false, error: "" }

export function MagicLinkForm({ next = "/dashboard" }: { next?: string }) {
  const [attempt, setAttempt] = useState(0)

  return <MagicLinkAttempt key={attempt} next={next} retry={attempt > 0} onRetry={() => setAttempt((value) => value + 1)} />
}

function MagicLinkAttempt({ next, retry, onRetry }: { next: string; retry: boolean; onRetry: () => void }) {
  const [state, formAction, pending] = useActionState(requestMagicLinkAction, initial)

  if (state.sent) {
    return (
      <div className="space-y-3">
        <p
          role="status"
          className="rounded-md border px-4 py-3 text-sm"
          style={{ borderColor: "var(--status-approved)", background: "var(--status-approved-bg)", color: "var(--text-body)" }}
        >
          If that email has a wallet, you can receive a sign-in link. Check your inbox and spam folder. Links are valid for 15 minutes.
        </p>
        <button type="button" onClick={onRetry} className="sn-btn sn-btn-secondary sn-btn-m w-full">
          Try another email or resend
        </button>
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="next" value={next} />
      <label className="block">
        <span className="text-[11px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Email</span>
        <input
          name="email"
          type="email"
          required
          autoFocus={retry}
          placeholder="you@company.com"
          className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none"
          style={{ borderColor: "var(--paper-3)", background: "var(--surface-card)", color: "var(--text-body)" }}
        />
      </label>
      {state.error && <p role="alert" className="text-sm text-red-400">{state.error}</p>}
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
