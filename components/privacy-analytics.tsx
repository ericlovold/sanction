"use client"

import { Analytics } from "@vercel/analytics/next"
import { usePathname } from "next/navigation"

const verificationPaths = new Set(["/auth/verify", "/connect/mcp/login/verify"])

export function PrivacyAnalytics() {
  const pathname = usePathname()
  if (verificationPaths.has(pathname)) return null
  return <Analytics beforeSend={(event) => {
    // Also guard an already-loaded analytics script during client navigation.
    if (verificationPaths.has(new URL(event.url).pathname)) return null
    return event
  }} />
}
