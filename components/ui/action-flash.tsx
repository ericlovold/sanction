"use client"

import { useEffect, useState } from "react"
import { Check, AlertCircle } from "lucide-react"

type FlashState = { ok: boolean; message: string }

// A transient completion signal for server-action forms. A success announces
// the finished task, then reverts to the default (empty) resting state after a
// beat — no stale label left sitting on the page. Errors persist until the next
// action so they can be read and fixed.
//
// When a new action result arrives (useActionState hands back a fresh object
// every dispatch) we reset what's shown *during render* — React's blessed
// pattern for adjusting state to a prop, no effect needed. The effect only
// schedules the auto-dismiss timer; its setState runs later in the timeout
// callback, never synchronously inside the effect.
export function ActionFlash({
  state,
  successMs = 4000,
  className = "",
}: {
  state: FlashState
  successMs?: number
  className?: string
}) {
  const [shown, setShown] = useState<FlashState | null>(state.message ? state : null)
  const [seen, setSeen] = useState(state)

  if (state !== seen) {
    setSeen(state)
    setShown(state.message ? state : null)
  }

  useEffect(() => {
    if (!shown || !shown.ok) return // errors stay until the next action
    const id = setTimeout(() => setShown(null), successMs)
    return () => clearTimeout(id)
  }, [shown, successMs])

  if (!shown) return null

  const ok = shown.ok
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 ${
        ok
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
          : "border-red-500/30 bg-red-500/10 text-red-300"
      } ${className}`}
    >
      <span className="grid h-4 w-4 shrink-0 place-items-center">
        {ok ? <Check className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
      </span>
      <span>{shown.message}</span>
    </div>
  )
}
