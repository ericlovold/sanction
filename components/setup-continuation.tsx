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
    <p className="text-sm">Next: connect your AI tool and try a human approval.</p>
    {!dismissed && <>
      <div id="connect-tools" className="scroll-mt-28 space-y-3">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-[var(--roster-fog)]">
          <li>Connect your AI tool using the guide.</li>
          <li>Ask it for the guide’s harmless synthetic approval request.</li>
          <li>Review the request in your approval inbox.</li>
        </ol>
        <div className="flex flex-wrap items-center gap-4">
          <Link href="/docs/connect" className="inline-block rounded bg-[var(--roster-brass)] px-4 py-2 text-sm font-medium text-[var(--roster-ink)]">Connect your AI tool</Link>
          <Link href="/dashboard/approvals" className="text-sm underline">Open approval inbox</Link>
        </div>
        <p className="text-sm text-[var(--roster-fog)]">Your AI host must ask Sanction and honor its decision. The connector does not intercept the host’s other tools. The synthetic test executes no external action.</p>
      </div>
      <details>
        <summary className="cursor-pointer text-sm">{proofComplete ? "Completed: governed tool-call test" : "Optional: try the broker tool-call test"}</summary>
        <p className="mt-2 text-sm text-[var(--roster-fog)]">{proofComplete
          ? "One approved execution recorded. Changed arguments and grant reuse were refused on the test path."
          : "Run a harmless test, review its request, then verify one approved execution. Your progress is saved so you can return here."}</p>
        <Link className="text-sm underline" href="/dashboard/walkthrough">{proofComplete ? "View proof" : "Start or resume the tool-call test"}</Link>
      </details>
      <details>
        <summary className="cursor-pointer text-sm">Developer usage, gateway, and broker options</summary>
        <div className="mt-3 space-y-3">
          <ul className="space-y-3 text-sm">
            <li><Link className="underline" href="/dashboard/connect">Claude Code or Codex usage</Link><p className="text-[var(--roster-fog)]">Report usage. Claude Code also has an optional approval hook for configured tool calls. Telemetry alone does not enforce limits.</p></li>
            <li><Link className="underline" href="/docs/gateway">Model API through the gateway</Link><p className="text-[var(--roster-fog)]">Meter model calls and enforce budgets on traffic routed through Sanction.</p></li>
            <li><Link className="underline" href="/docs/agent-wallet">MCP broker</Link><p className="text-[var(--roster-fog)]">Use the broker to intercept calls to an upstream. Hosted MCP relies on your agent asking for authorization.</p></li>
          </ul>
          <Link className="inline-block text-sm underline" href="/dashboard/usage">Check reported developer activity</Link>
        </div>
      </details>
      {children && <details>
        <summary className="cursor-pointer text-sm">More setup: decisions, notifications, and policy</summary>
        <div className="mt-3">{children}</div>
      </details>}
    </>}
  </section>
}
