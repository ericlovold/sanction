"use client"

import { useState, useSyncExternalStore } from "react"
import { Markdown } from "@/components/markdown"
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

// Keep setup, limitations, and test prompts tied to the maintained guide.
function section(source: string, heading: string) {
  const lines = source.split("\n")
  const start = lines.findIndex((line) => line === heading)
  if (start < 0) return ""
  const level = heading.match(/^#+/)?.[0].length ?? 1
  const end = lines.findIndex((line, index) => index > start && new RegExp(`^#{1,${level}} `).test(line))
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim()
}

function promptFrom(source: string) {
  return source.split("\n").filter((line) => line.startsWith("> ")).map((line) => line.slice(2)).join(" ")
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

export function ConnectionGuide({ source }: { source: string }) {
  const fragment = useSyncExternalStore(subscribeToFragment, getFragment, getServerFragment)
  const { host: selectedHost, step } = parseConnectionFragment(fragment)
  const host = selectedHost?.name ?? null
  function setStep(nextStep: number) {
    if (selectedHost) window.location.assign(connectionFragment(selectedHost, nextStep))
  }
  const intro = source.split("\n## ")[0]
  const choose = section(source, "## 1. Choose your host")
  const prerequisite = choose.split("\n\n")[0]
  const endpoint = choose.match(/```text\n([^\n]+)\n```/)?.[1]
  const row = source.split("\n").find((line) => line.startsWith(`| ${host} |`))?.split("|")
  const setup = row?.[2]?.trim()
  const evidence = row?.[3]?.trim()
  const hostDetails = host === "Cursor" || host === "Codex" ? section(source, `### ${host}`) : ""
  const check = section(source, "## 2. Check the connection")
  const request = section(source, "## 3. Request your first approval")
  const redemption = section(source, "## 4. Check once, then redeem exactly once")
  const stepSource = step === 1 ? check : request
  const prompt = promptFrom(stepSource)
  const canConnect = host !== null && host !== "ChatGPT"

  return (
    <>
      <Markdown source={intro} />
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
              {canConnect && <Markdown source={prerequisite} />}
              {canConnect && endpoint && (
                <div className="my-5">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Server URL</p>
                  <code className="mt-2 block break-all text-sm">{endpoint}</code>
                  <CopyButton key={`${host}:${step}`} text={endpoint} label="Copy endpoint" />
                </div>
              )}
              <p className="mt-5 text-xs uppercase tracking-wider text-muted-foreground">Setup</p>
              <Markdown source={setup ?? "See the full connection reference below for setup instructions."} />
              {hostDetails && <Markdown source={hostDetails} />}
              {host === "Grok Bot" && <Markdown source="Read the [Grok Bot guide](/docs/grok-bot) for OAuth and shared-account boundaries." />}
              {evidence && (
                <details className="mt-4 text-sm text-muted-foreground">
                  <summary className="cursor-pointer py-2">Recorded verification and limitations</summary>
                  <Markdown source={evidence} />
                </details>
              )}
              {canConnect && <button type="button" onClick={() => setStep(1)} className="mt-5 text-sm font-medium text-amber-200 underline underline-offset-4">Next: check the connection</button>}
            </>
          ) : (
            <>
              <h2 className="font-display text-xl font-semibold">{step === 1 ? "Check the connection" : "Request your first approval"}</h2>
              <Markdown source={stepSource} />
              {prompt && <CopyButton key={`${host}:${step}`} text={prompt} label={step === 1 ? "Copy connection check" : "Copy test request"} />}
              {step === 1 ? (
                <button type="button" onClick={() => setStep(2)} className="mt-4 text-sm font-medium text-amber-200 underline underline-offset-4">After a successful check: request approval</button>
              ) : (
                <details className="mt-6 border-t border-border pt-4">
                  <summary className="cursor-pointer font-medium">After your decision: check once, redeem once</summary>
                  <Markdown source={redemption} />
                </details>
              )}
            </>
          )}
        </section>
      )}

      <details className="mt-8 border-t border-border pt-6">
        <summary className="cursor-pointer font-medium">Full connection reference, troubleshooting, and disconnect</summary>
        <div className="mt-6"><Markdown source={source} /></div>
      </details>
    </>
  )
}
