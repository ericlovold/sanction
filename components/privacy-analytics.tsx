"use client"

import { Analytics } from "@vercel/analytics/next"
import { usePathname } from "next/navigation"

const verificationPath = "/connect/mcp/login/verify"

export function PrivacyAnalytics() {
  const pathname = usePathname()
  if (pathname === verificationPath) return null
  return <Analytics beforeSend={(event) => {
    // Also guard an already-loaded analytics script during client navigation.
    if (new URL(event.url).pathname === verificationPath) return null
    return event
  }} />
}
