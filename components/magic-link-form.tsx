"use client"

import { useActionState } from "react"
import { requestMagicLinkAction, type MagicLinkRequestState } from "@/app/login/actions"

const initial: MagicLinkRequestState = { sent: false, error: "" }

export function MagicLinkForm() {
  const [state, formAction, pending] = useActionState(requestMagicLinkAction, initial)

  if (state.sent) {
    return (
      <p className="rounded-md border border-signal/25 bg-signal/10 px-4 py-3 text-sm text-signal">
        If that email has a wallet, a sign-in link is on its way. Check your inbox — it&apos;s valid for 15 minutes.
      </p>
    )
  }

  return (
    <form action={formAction} className="space-y-3">
      <label className="block">
        <span className="text-[11px] uppercase tracking-wide text-foreground0">Email</span>
        <input
          name="email"
          type="email"
          required
          placeholder="you@company.com"
          className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
        />
      </label>
      {state.error && <p className="text-sm text-red-400">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md border border-input px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-ring/50 hover:text-foreground disabled:opacity-50"
      >
        {pending ? "Sending…" : "Email me a sign-in link"}
      </button>
    </form>
  )
}
