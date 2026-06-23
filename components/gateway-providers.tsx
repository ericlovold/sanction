"use client"

import { useState } from "react"

// The cross-provider story made visible: set a model SDK's base URL to one of
// these and add x-sanction-key. The gateway proxies to the real provider, meters
// every token, and enforces the budget. Same key, any provider.
const PROVIDERS = [
  { label: "Anthropic", url: "https://getsanction.com/api/gateway/anthropic" },
  { label: "OpenAI", url: "https://getsanction.com/api/gateway/openai" },
  { label: "Gemini", url: "https://getsanction.com/api/gateway/gemini" },
]

function CopyMini({ value }: { value: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(value)
        setDone(true)
        setTimeout(() => setDone(false), 1200)
      }}
      className="shrink-0 rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-400 transition-colors hover:text-zinc-100"
    >
      {done ? "copied" : "copy"}
    </button>
  )
}

function Row({ label, value, copy }: { label: string; value: string; copy: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
      <span className="w-[68px] shrink-0 text-xs text-zinc-500">{label}</span>
      {/* a value to copy, not a link to open — deliberately not an <a> */}
      <code className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-300">{value}</code>
      <CopyMini value={copy} />
    </div>
  )
}

export function GatewayProviders({ agentKey }: { agentKey: string }) {
  const example = `import OpenAI from "openai"

const client = new OpenAI({
  baseURL: "https://getsanction.com/api/gateway/openai",
  defaultHeaders: { "x-sanction-key": "${agentKey}" },
})
// now call client as normal — Sanction meters + caps, then forwards to OpenAI`

  return (
    <div>
      <span className="text-[11px] uppercase tracking-wide text-zinc-500">Route a provider through Sanction</span>
      <p className="mt-1 text-xs text-zinc-400">
        These are base URLs for your code — <span className="text-zinc-300">don&apos;t open them in a browser</span>.
        Point your model SDK at one and send the <code className="font-mono text-zinc-300">x-sanction-key</code> header.
        Your agent calls it exactly like the real provider; Sanction meters + caps the spend and forwards the request.
      </p>
      <div className="mt-2 space-y-1.5">
        {PROVIDERS.map((p) => (
          <Row key={p.label} label={p.label} value={p.url} copy={p.url} />
        ))}
        <Row label="Header" value={`x-sanction-key: ${agentKey}`} copy={`x-sanction-key: ${agentKey}`} />
      </div>
      <div className="mt-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-wide text-zinc-500">Example — OpenAI SDK</span>
          <CopyMini value={example} />
        </div>
        <pre className="mt-1 overflow-x-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 text-[11px] leading-relaxed text-zinc-300">
          <code>{example}</code>
        </pre>
      </div>
    </div>
  )
}
