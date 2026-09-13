"use client"

import Link from "next/link"
import { useState, type ReactNode } from "react"

export function SetupContinuation({ proofComplete, children }: {
  proofComplete: boolean
  children?: ReactNode
}) {
  const [dismissed, setDismissed] = useState(false)

  return <section aria-label="Continue setup" className="rounded border border-[var(--roster-rule)] bg-[var(--roster-paper)] text-[var(--roster-signal)] p-5 space-y-4">
    <div className="flex items-center justify-between gap-4">
      <h2 className="font-medium">Continue setup</h2>
      <button className="text-xs underline" onClick={() => setDismissed(!dismissed)}>
        {dismissed ? "Resume setup" : "Hide steps"}
      </button>
    </div>
    <p className="text-sm">{proofComplete ? "Next: connect your own agent." : "Next: see Sanction pause a tool call for your approval."}</p>
    {!dismissed && <>
      {!proofComplete ? <>
        <p className="text-sm text-[var(--roster-fog)]">Run a harmless test, review its request, then verify one approved execution. Your progress is saved so you can return here.</p>
        <Link href="/dashboard/walkthrough" className="inline-block rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Start or resume the tool-call test</Link>
      </> : <>
        <details>
          <summary className="cursor-pointer text-sm">Completed: governed tool-call test</summary>
          <p className="mt-2 text-sm text-[var(--roster-fog)]">One approved execution recorded. Changed arguments and grant reuse were refused on the test path.</p>
          <Link className="text-sm underline" href="/dashboard/walkthrough">View proof</Link>
        </details>
        <div id="connect-tools" className="scroll-mt-28 space-y-3">
          <h3 className="font-medium">Connect your agent</h3>
          <p className="text-sm text-[var(--roster-fog)]">Choose the path your tool supports. Each has a different scope of control.</p>
          <ul className="space-y-3 text-sm">
            <li><Link className="underline" href="/dashboard/connect">Claude Code or Codex</Link><p className="text-[var(--roster-fog)]">Report usage. Claude Code also has an optional approval hook for configured tool calls. Telemetry alone does not enforce limits.</p></li>
            <li><Link className="underline" href="/docs/gateway">Model API through the gateway</Link><p className="text-[var(--roster-fog)]">Meter model calls and enforce budgets on traffic routed through Sanction.</p></li>
            <li><Link className="underline" href="/docs/agent-wallet">MCP tools</Link><p className="text-[var(--roster-fog)]">Use the broker to intercept calls to an upstream. Hosted MCP relies on your agent asking for authorization.</p></li>
          </ul>
          <Link className="inline-block text-sm underline" href="/dashboard/usage">Check reported developer activity</Link>
        </div>
      </>}
      {children && <details>
        <summary className="cursor-pointer text-sm">More setup: decisions, notifications, and policy</summary>
        <div className="mt-3">{children}</div>
      </details>}
    </>}
  </section>
}
