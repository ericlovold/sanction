"use client"

import { useActionState, useState } from "react"
import { resetManagementKeyAction, type MgmtKeyState } from "@/app/dashboard/keys/actions"

const init: MgmtKeyState = { ok: false, error: "" }

// The master key — the sk_ that gates your whole management plane. This card is
// deliberately loud: a user who lost their admin key must be able to reset it in
// one obvious, confirm-gated click, then copy the new one (shown once).
export function ManagementKeyCard({ prefix, editable }: { prefix: string | null; editable: boolean }) {
  const [state, formAction, pending] = useActionState(resetManagementKeyAction, init)
  const [copied, setCopied] = useState(false)
  const hasKey = !!prefix
  const label = pending ? "Resetting…" : hasKey ? "Reset management key" : "Generate management key"

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.05] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold tracking-tight text-foreground">Management key (your master admin key)</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The <code className="font-mono text-foreground">sk_…</code> key that authorizes everything on the management
            plane: creating agents, editing policy, the vault, and the admin API. Treat it like a root password.
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${
            hasKey
              ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400"
              : "border-amber-500/30 bg-amber-500/10 text-amber-400"
          }`}
        >
          {hasKey ? "set" : "not set yet"}
        </span>
      </div>

      {hasKey && (
        <p className="mt-3 font-mono text-sm text-muted-foreground">
          current: <span className="text-foreground">{prefix}••••••••••••</span>
        </p>
      )}

      {/* The new key, shown exactly once. */}
      {state.ok && state.newKey ? (
        <div className="mt-4 rounded-md border border-emerald-500/30 bg-emerald-500/[0.06] p-4">
          <p className="text-sm font-semibold text-emerald-300">Your new management key — copy it now, it&rsquo;s shown once.</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded border border-border bg-card px-3 py-2 font-mono text-sm text-foreground">
              {state.newKey}
            </code>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(state.newKey!)
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
              }}
              className="shrink-0 rounded-md bg-emerald-500 px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-emerald-400"
            >
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            The previous key stopped working the moment this was created. Store this in your password manager now.
          </p>
        </div>
      ) : (
        <form
          action={formAction}
          className="mt-4"
          onSubmit={(e) => {
            const msg = hasKey
              ? "Reset your management key? Your current sk_ key stops working immediately — anything using it (scripts, MCP config, Bedrock) must be updated with the new key."
              : "Generate a management key for this account? You'll get an sk_ key shown once."
            if (!window.confirm(msg)) e.preventDefault()
          }}
        >
          <button
            type="submit"
            disabled={!editable || pending}
            className="rounded-md bg-amber-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-amber-400 disabled:opacity-40"
          >
            {label}
          </button>
          {!editable && (
            <p className="mt-2 text-xs text-muted-foreground">Log in to this account to reset its management key.</p>
          )}
          {state.error && <p className="mt-2 text-sm text-red-400">{state.error}</p>}
        </form>
      )}
    </div>
  )
}
