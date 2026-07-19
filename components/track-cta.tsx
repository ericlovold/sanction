"use client"

import Link from "next/link"
import type { ReactNode } from "react"
import { track } from "@vercel/analytics"
import { FUNNEL } from "@/lib/funnel"

// A marketing CTA that records the click as a funnel event before navigating.
// Renders an external <a> for http(s) links (calendly) and a Next <Link> for
// in-app routes, so it drops in for either without changing behavior. The
// track() is fire-and-forget and guarded — an ad-blocker or a thrown analytics
// call must never swallow the click.
export function TrackCTA({
  href,
  location,
  target,
  className,
  children,
}: {
  href: string
  location: string // where on the page: "hero" | "nav" | "seat-section" | ...
  target: string // where it goes: "start" | "talk" | "demo" | ...
  className?: string
  children: ReactNode
}) {
  const fire = () => {
    try {
      track(FUNNEL.landingCta, { location, target })
    } catch {
      /* analytics is best-effort; never block the navigation */
    }
  }

  if (/^https?:\/\//.test(href)) {
    return (
      <a href={href} className={className} target="_blank" rel="noopener" onClick={fire}>
        {children}
      </a>
    )
  }
  return (
    <Link href={href} className={className} onClick={fire}>
      {children}
    </Link>
  )
}
