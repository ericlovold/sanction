"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { FIRST_APPROVAL_PROMPT } from "@/lib/firstHour"
import { useState, useTransition, type ReactNode } from "react"

export function SetupContinuation({ proofComplete, hasMcpConnection = false, hasDecision = false, children }: {
  proofComplete: boolean
  hasMcpConnection?: boolean
  hasDecision?: boolean
  children?: ReactNode
}) {
  const setupComplete = hasMcpConnection && hasDecision
  const heading = setupComplete ? "Setup complete" : "Continue setup"
  const router = useRouter()
  const [checking, startChecking] = useTransition()
  const [dismissed, setDismissed] = useState(false)
  const [copyStatus, setCopyStatus] = useState("")
  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(FIRST_APPROVAL_PROMPT)
      setCopyStatus("Copied. Paste this into your connected AI tool.")
    } catch {
      setCopyStatus("Could not copy. Select and copy the prompt below.")
    }
  }

  return <section aria-label={heading} className="rounded border border-[var(--roster-rule)] bg-[var(--roster-paper)] text-[var(--roster-signal)] p-5 space-y-4">
    <div className="flex items-center justify-between gap-4">
      <h2 className="font-medium">{heading}</h2>
      <button className="text-xs underline" onClick={() => setDismissed(!dismissed)}>
        {setupComplete ? (dismissed ? "Show details" : "Hide details") : (dismissed ? "Resume setup" : "Hide steps")}
      </button>
    </div>
    <p className="text-sm">{!hasMcpConnection ? "Next: connect your AI tool and try a human approval." : hasDecision ? "Connected. Your first authorization is on the record." : "Connected. Next: request your first approval."}</p>
    {!dismissed && <>
      <div id="connect-tools" className="scroll-mt-28 space-y-3">
        <ul className="space-y-1 text-sm text-[var(--roster-fog)]" aria-label="Setup progress" aria-live="polite" aria-busy={checking}>
          <li>{hasMcpConnection ? "Connected via MCP" : "MCP connection not yet detected"}</li>
          <li>{hasDecision ? "First authorization recorded in this wallet" : "First authorization not yet recorded"}</li>
        </ul>
        <div className="space-y-1">
          <button type="button" disabled={checking} onClick={() => startChecking(() => router.refresh())} className="text-sm underline disabled:cursor-wait disabled:opacity-60">
            {checking ? "Checking setup progress…" : "Check setup progress"}
          </button>
          <p className="text-xs text-[var(--roster-fog)]">Returned from your AI tool? Check for your saved connection or first authorization. This does not send a new approval request.</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {!hasMcpConnection ? <Link href="/docs/connect" className="inline-block rounded bg-[var(--roster-brass)] px-4 py-2 text-sm font-medium text-[var(--roster-ink)]">Connect your AI tool</Link>
            : !hasDecision ? <button type="button" onClick={copyPrompt} className="rounded bg-[var(--roster-brass)] px-4 py-2 text-sm font-medium text-[var(--roster-ink)]">Copy first approval request</button>
            : <Link href="/dashboard/approvals" className="inline-block rounded bg-[var(--roster-brass)] px-4 py-2 text-sm font-medium text-[var(--roster-ink)]">Open approval inbox</Link>}
          {!hasDecision && <Link href="/dashboard/approvals" className="text-sm underline">Open approval inbox</Link>}
          {hasMcpConnection && <Link href="/connect/mcp" className="text-sm underline">Manage connections</Link>}
        </div>
        {hasMcpConnection && !hasDecision && <div className="space-y-2">
          <p className="text-sm text-[var(--roster-fog)]">Paste this into your connected AI tool, then review its request in the approval inbox.</p>
          <p role="status" className="text-sm">{copyStatus}</p>
          <details>
            <summary className="cursor-pointer text-sm">View or manually copy the test prompt</summary>
            <p className="mt-2 select-text break-words rounded border border-[var(--roster-rule)] p-3 text-sm">{FIRST_APPROVAL_PROMPT}</p>
          </details>
        </div>}
        <p className="text-sm text-[var(--roster-fog)]">Your AI host must ask Sanction and honor its decision. The connector does not intercept the host’s other tools. The synthetic test executes no external action.</p>
        <details>
          <summary className="cursor-pointer text-xs text-[var(--roster-fog)]">What these milestones mean</summary>
          <p className="mt-2 text-xs text-[var(--roster-fog)]">Connection status reflects registered OAuth access, not host availability. API-key setups may not appear here. Authorization records can come from an agent or a dashboard test; they do not confirm execution.</p>
        </details>
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
