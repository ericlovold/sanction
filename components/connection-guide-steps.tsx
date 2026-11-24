"use client"

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react"
import { agentBlockSteps, agentConnectBlock, type AgentBlockAccount } from "@/lib/agentConnectBlock"
import { connectionHosts, connectionFragment, parseConnectionFragment } from "@/lib/connectionGuideNavigation"

function subscribeToFragment(onChange: () => void) {
  window.addEventListener("hashchange", onChange)
  return () => window.removeEventListener("hashchange", onChange)
}

function getFragment() {
  return window.location.hash
}

function getServerFragment() {
  return ""
}

type GuideStep = { content: ReactNode; prompt: string }

export type ConnectionGuideContent = {
  intro: ReactNode
  prerequisite: ReactNode
  endpoint?: string
  hosts: Record<string, { setup: ReactNode; details: ReactNode; evidence: ReactNode }>
  check: GuideStep
  request: GuideStep
  redemption: GuideStep
  reference: ReactNode
  agent: { rules: string; setup: Record<string, string> }
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [message, setMessage] = useState("")
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setMessage("Copied.")
    } catch {
      setMessage("Could not copy. Select and copy the text above.")
    }
  }
  return (
    <div className="mt-3">
      <button type="button" onClick={copy} className="rounded-md border border-amber-400/40 bg-amber-400/10 px-4 py-2 text-sm font-medium text-amber-200 hover:bg-amber-400/20 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300">
        {label}
      </button>
      <p role="status" className="mt-2 min-h-5 text-sm text-muted-foreground">{message}</p>
    </div>
  )
}

// The page is prerendered and shared, so account details arrive after load and
// only for a real session. Until then, and when signed out, the block is generic.
function useAgentBlockAccount() {
  const [account, setAccount] = useState<AgentBlockAccount | null>(null)
  useEffect(() => {
    let current = true
    fetch("/api/connect/agent-facts", { credentials: "same-origin", cache: "no-store" })
      .then(response => response.ok ? response.json() : null)
      .then(body => { if (current && body?.account) setAccount(body.account) })
      .catch(() => {})
    return () => { current = false }
  }, [])
  return account
}

function AgentBlock({ text, account }: { text: string; account: AgentBlockAccount | null }) {
  return (
    <div className="my-5 rounded-md border border-border bg-muted/30 p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">For your agent</p>
      <p className="mt-2 text-sm text-muted-foreground">
        {account
          ? <>Filled in for <span className="text-foreground">{account.wallet}</span>. Paste it into your AI tool&apos;s chat. It contains no key.</>
          : <>Paste this into your AI tool&apos;s chat. It contains no key. <a href="/login?next=%2Fdocs%2Fconnect" className="text-amber-200 underline underline-offset-4">Sign in</a> to fill in your wallet and seats.</>}
      </p>
      <pre tabIndex={0} aria-label="Text to paste into your AI tool" className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-background p-3 font-mono text-xs leading-relaxed text-foreground focus-visible:outline-2 focus-visible:outline-amber-300">{text}</pre>
      <CopyButton key={text} text={text} label="Copy for your agent" />
    </div>
  )
}

export function ConnectionGuideSteps({ content }: { content: ConnectionGuideContent }) {
  const fragment = useSyncExternalStore(subscribeToFragment, getFragment, getServerFragment)
  const { host: selectedHost, step } = parseConnectionFragment(fragment)
  const host = selectedHost?.name ?? null
  function setStep(nextStep: number) {
    if (selectedHost) window.location.assign(connectionFragment(selectedHost, nextStep))
  }
  const hostContent = selectedHost ? content.hosts[selectedHost.slug] : null
  const { endpoint } = content
  const currentStep = step === 1 ? content.check : content.request
  const followUpPrompt = content.redemption.prompt
  const canConnect = host !== null && host !== "ChatGPT"
  const account = useAgentBlockAccount()
  const agentText = selectedHost && endpoint ? agentConnectBlock(selectedHost.slug, agentBlockSteps[step], {
    endpoint, ...content.agent, prompts: { check: content.check.prompt, request: content.request.prompt },
  }, account) : null

  return (
    <>
      {content.intro}
      <fieldset className="mt-8">
        <legend className="font-display text-xl font-semibold">Choose your AI host</legend>
        <div className="mt-4 flex flex-wrap gap-2">
          {connectionHosts.map((option) => (
            <button key={option.slug} type="button" aria-pressed={host === option.name} onClick={() => { window.location.assign(connectionFragment(option, 0)) }} className={`rounded-md border px-4 py-2.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300 ${host === option.name ? "border-amber-400/60 bg-amber-400/10 text-amber-200" : "border-border text-muted-foreground hover:text-foreground"}`}>
              {option.name}
            </button>
          ))}
        </div>
      </fieldset>

      {host && (
        <section className="mt-6 rounded-lg border border-border p-5 sm:p-6" aria-label={`${host} connection guide`}>
          {canConnect && (
            <nav aria-label="Connection steps" className="mb-6 flex flex-wrap gap-2 border-b border-border pb-4">
              {["Connect", "Check", "Request approval"].map((label, index) => (
                <button key={label} type="button" aria-current={step === index ? "step" : undefined} onClick={() => setStep(index)} className={`rounded px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-amber-300 ${step === index ? "bg-amber-400/10 text-amber-200" : "text-muted-foreground hover:text-foreground"}`}>
                  {index + 1}. {label}
                </button>
              ))}
            </nav>
          )}
          {step === 0 ? (
            <>
              <h2 className="font-display text-xl font-semibold">{host === "ChatGPT" ? "ChatGPT availability" : `Connect ${host}`}</h2>
              {canConnect && content.prerequisite}
              {canConnect && endpoint && (
                <div className="my-5">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Server URL</p>
                  <code className="mt-2 block break-all text-sm">{endpoint}</code>
                  <CopyButton key={`${host}:${step}`} text={endpoint} label="Copy endpoint" />
                </div>
              )}
              <p className="mt-5 text-xs uppercase tracking-wider text-muted-foreground">Setup</p>
              {hostContent?.setup}
              {hostContent?.details}
              {agentText && <AgentBlock text={agentText} account={account} />}
              {hostContent?.evidence && (
                <details className="mt-4 text-sm text-muted-foreground">
                  <summary className="cursor-pointer py-2">Recorded verification and limitations</summary>
                  {hostContent.evidence}
                </details>
              )}
              {canConnect && <button type="button" onClick={() => setStep(1)} className="mt-5 text-sm font-medium text-amber-200 underline underline-offset-4">Next: check the connection</button>}
            </>
          ) : (
            <>
              <h2 className="font-display text-xl font-semibold">{step === 1 ? "Check the connection" : "Request your first approval"}</h2>
              {currentStep.content}
              {agentText && <AgentBlock text={agentText} account={account} />}
              {step === 2 && (
                <div className="mt-4 space-y-2">
                  <a href="/dashboard/approvals" target="_blank" rel="noopener noreferrer" className="inline-block rounded-md border border-amber-400/40 bg-amber-400/10 px-4 py-2 text-sm font-medium text-amber-200 hover:bg-amber-400/20 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300">
                    Open approval inbox (new tab)
                  </a>
                  <p className="text-sm text-muted-foreground">After your AI tool returns a pending request, review it in the inbox. Then return here for the follow-up prompt below.</p>
                </div>
              )}
              {step === 1 ? (
                <button type="button" onClick={() => setStep(2)} className="mt-4 text-sm font-medium text-amber-200 underline underline-offset-4">After a successful check: request approval</button>
              ) : (
                <details className="mt-6 border-t border-border pt-4">
                  <summary className="cursor-pointer font-medium">After your decision: check once, redeem once</summary>
                  {followUpPrompt && <CopyButton key={`${host}:follow-up`} text={followUpPrompt} label="Copy follow-up prompt" />}
                  {content.redemption.content}
                </details>
              )}
            </>
          )}
        </section>
      )}

      <details className="mt-8 border-t border-border pt-6">
        <summary className="cursor-pointer font-medium">Full connection reference, troubleshooting, and disconnect</summary>
        <div className="mt-6">{content.reference}</div>
      </details>
    </>
  )
}
