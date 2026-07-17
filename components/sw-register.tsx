"use client"

import { useEffect } from "react"

// Registers the dashboard service worker (public/sw.js) — in production only.
// Client-only, fires once after hydration; harmless where service workers are
// unsupported.
//
// Dev is excluded on purpose (2026-07-16): sw.js is cache-first for
// /_next/static/*, which is immutable in production (content-hashed per
// deploy) but NOT in dev — Turbopack reuses chunk URLs across HMR rebuilds,
// so a cached chunk hydrates stale code against fresh server HTML and the
// page mismatches (old nav over new pages, dead references). The dev
// cleanup for already-poisoned browsers lives in the dashboard layout as an
// inline script, NOT here: this component ships as a static chunk, so a
// stale SW would serve the old version of it and the fix could never land.
export function SwRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return
    if (process.env.NODE_ENV !== "production") return
    navigator.serviceWorker.register("/sw.js").catch(() => {})
  }, [])
  return null
}
