"use client"

import { track } from "@vercel/analytics"
import { FUNNEL } from "@/lib/funnel"

export function SlackInstallCta() {
  return (
    <a
      href="/api/slack/oauth/start"
      onClick={() => track(FUNNEL.slackInstallStarted, { location: "slack-page" })}
      className="inline-flex rounded-md px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
      style={{ background: "var(--pine-7)" }}
    >
      Add to Slack
    </a>
  )
}
