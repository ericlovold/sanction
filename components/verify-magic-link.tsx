"use client"

import { useActionState, useState } from "react"
import Link from "next/link"
import { verifyMagicLinkAction, type MagicLinkVerifyState } from "@/app/login/actions"

const initial: MagicLinkVerifyState = { ok: false, error: "" }

export function VerifyMagicLink({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(verifyMagicLinkAction, initial)
  const [copied, setCopied] = useState(false)

  if (state.ok && state.newKey) {
    const key = state.newKey
    return (
      <div className="space-y-5">
        <div className="rounded-md border border-signal/25 bg-signal/10 px-4 py-3 text-sm text-signal">
          You&apos;re signed in{state.walletName ? ` to ${state.walletName}` : ""}. Here&apos;s your new management key — save it now; your old one no longer works.
        </div>
        <div>
          <span className="text-[11px] uppercase tracking-wide text-foreground0">New management key</span>
          <div className="mt-1 flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5">
            <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{key}</code>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(key)
                setCopied(true)
                setTimeout(() => setCopied(false), 1200)
              }}
              className="shrink-0 rounded border border-input px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              {copied ? "copied" : "copy"}
            </button>
          </div>
        </div>
        <Link
          href="/dashboard"
          className="inline-block rounded-md bg-signal px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Open my dashboard →
        </Link>
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <p className="text-sm text-muted-foreground">
        Click to finish signing in. This issues a fresh management key and signs you in on this device.
      </p>
      {state.error && (
        <p className="text-sm text-red-400">
          {state.error} <Link href="/login" className="text-signal hover:text-signal">Back to sign in →</Link>
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-signal px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
      >
        {pending ? "Signing in…" : "Finish signing in"}
      </button>
    </form>
  )
}
