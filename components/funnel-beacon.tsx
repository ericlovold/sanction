"use client"

import { useEffect, useRef } from "react"
import { track } from "@vercel/analytics"
import type { FunnelEvent } from "@/lib/funnel"

// Fires a single funnel event once when it mounts — for stages that are a page
// view rather than a click (e.g. "opened the demo dashboard"). Deduped per mount
// with a ref so React 18 strict-mode double-invoke doesn't double-count. Renders
// nothing.
export function FunnelBeacon({ event, data }: { event: FunnelEvent; data?: Record<string, string | number | boolean> }) {
  const fired = useRef(false)
  useEffect(() => {
    if (fired.current) return
    fired.current = true
    try {
      track(event, data)
    } catch {
      /* best-effort */
    }
  }, [event, data])
  return null
}
