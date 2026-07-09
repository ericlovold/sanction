"use client"

import { useEffect, useRef, useState } from "react"
import { track } from "@vercel/analytics"

// Polls /api/v1/activity until the gateway meters this agent's first real call,
// then flips to a confirmation — closes the onboarding loop without a refresh.
// Bounded: stops after the first hit or ~5 minutes, and pauses when the tab hides.
type Last = { model: string; tokensIn: number; tokensOut: number; costUsd: number }

const INTERVAL_MS = 5000
const MAX_ATTEMPTS = 60

// "light" renders with brand.css tokens — only use inside a `.sanction`-scoped page.
export function GatewayWatch({ agentKey, variant = "dark" }: { agentKey: string; variant?: "dark" | "light" }) {
  const [last, setLast] = useState<Last | null>(null)
  const attempts = useRef(0)
  const light = variant === "light"

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
      <div
        className={light ? "flex items-center gap-2 rounded-md border px-3 py-2 text-xs" : "flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-2 text-xs"}
        style={light ? { borderColor: "var(--status-approved)", background: "var(--status-approved-bg)" } : undefined}
      >
        <span className={light ? "font-semibold" : "font-semibold text-emerald-300"} style={light ? { color: "var(--status-approved)" } : undefined}>
          ✓ First call received
        </span>
        <span className={light ? undefined : "text-zinc-400"} style={light ? { color: "var(--text-secondary)" } : undefined}>
          {last.model} · {tokens} tokens · ${last.costUsd.toFixed(4)} metered
        </span>
      </div>
    )
  }

  return (
    <div className={light ? "flex items-center gap-2 px-1 text-xs" : "flex items-center gap-2 px-1 text-xs text-zinc-500"} style={light ? { color: "var(--text-muted)" } : undefined}>
      <span className={light ? "h-1.5 w-1.5 animate-pulse rounded-full" : "h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-500"} style={light ? { background: "var(--text-muted)" } : undefined} />
      Watching for your first call through the gateway…
    </div>
  )
}
