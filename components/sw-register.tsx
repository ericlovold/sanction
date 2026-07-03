"use client"

import { useEffect } from "react"

// Registers the dashboard service worker (public/sw.js). Client-only, fires
// once after hydration; harmless where service workers are unsupported.
export function SwRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {})
    }
  }, [])
  return null
}
