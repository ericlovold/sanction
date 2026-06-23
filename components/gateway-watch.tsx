"use client"

import { useEffect, useRef, useState } from "react"
import { track } from "@vercel/analytics"

// Polls /api/v1/activity until the gateway meters this agent's first real call,
// then flips to a confirmation — closes the onboarding loop without a refresh.
// Bounded: stops after the first hit or ~5 minutes, and pauses when the tab hides.
type Last = { model: string; tokensIn: number; tokensOut: number; costUsd: number }

const INTERVAL_MS = 5000
const MAX_ATTEMPTS = 60

export function GatewayWatch({ agentKey }: { agentKey: string }) {
  const [last, setLast] = useState<Last | null>(null)
  const attempts = useRef(0)

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout>

    async function poll() {
      if (!active) return
      if (document.visibilityState === "visible") {
        try {
          const res = await fetch("/api/v1/activity", { headers: { "x-api-key": agentKey } })
          const data = await res.json().catch(() => null)
          if (active && data?.firstCall && data.last) {
            setLast(data.last)
            track("first_gateway_call", { model: data.last.model })
            return
          }
        } catch {
          // transient — keep polling
        }
      }
      if (active && (attempts.current += 1) < MAX_ATTEMPTS) {
        timer = setTimeout(poll, INTERVAL_MS)
      }
    }

    timer = setTimeout(poll, INTERVAL_MS)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [agentKey])

  if (last) {
    const tokens = (last.tokensIn + last.tokensOut).toLocaleString()
    return (
      <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-2 text-xs">
        <span className="font-semibold text-emerald-300">✓ First call received</span>
        <span className="text-zinc-400">
          {last.model} · {tokens} tokens · ${last.costUsd.toFixed(4)} metered
        </span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 px-1 text-xs text-zinc-500">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-500" />
      Watching for your first call through the gateway…
    </div>
  )
}
