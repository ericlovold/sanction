"use client"

import { useActionState } from "react"
import { setEnforcementModeAction, type ObserveActionState } from "@/app/dashboard/observe/actions"

const initial: ObserveActionState = { ok: false, message: "" }

// The flip between observe and enforce, one pool at a time. Turning enforcement
// on is the consequential direction — the same decisions start binding — so it
// confirm-gates; dropping back to observe is always safe and doesn't.
export function EnforcementToggle({
  walletId,
  poolName,
  mode,
  editable,
}: {
  walletId: string
  poolName: string
  mode: "enforce" | "observe"
  editable: boolean
}) {
  const [state, formAction, pending] = useActionState(setEnforcementModeAction, initial)
  const target = mode === "observe" ? "enforce" : "observe"

  return (
    <div className="flex flex-col items-start gap-1 lg:items-end">
      <form
        action={formAction}
        onSubmit={(e) => {
          if (
            target === "enforce" &&
            !window.confirm(
              `Enforce policy on "${poolName}"? Decisions that have been observing as denials or escalations will start blocking and paging a human.`,
            )
          ) {
            e.preventDefault()
          }
        }}
      >
        <input type="hidden" name="wallet_id" value={walletId} />
        <input type="hidden" name="mode" value={target} />
        <button
          type="submit"
          disabled={!editable || pending}
          className={
            target === "enforce"
              ? "rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-emerald-400 disabled:opacity-40"
              : "rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-40"
          }
        >
          {pending ? "Saving…" : target === "enforce" ? "Turn on enforcement" : "Switch to observe"}
        </button>
      </form>
      {state.message && (
        <p className={`text-[11px] ${state.ok ? "text-emerald-400" : "text-red-400"}`} aria-live="polite">
          {state.message}
        </p>
      )}
    </div>
  )
}
