"use client"

import { useState } from "react"

// The cross-provider story made visible: point a model client's base URL at one
// of these and add x-sanction-key. The gateway proxies to the real provider,
// meters every token, and enforces the wallet/agent budget. Same key, any provider.
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
      <code className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-300">{value}</code>
      <CopyMini value={copy} />
    </div>
  )
}

export function GatewayProviders({ agentKey }: { agentKey: string }) {
  return (
    <div>
      <span className="text-[11px] uppercase tracking-wide text-zinc-500">Route a provider through Sanction</span>
      <p className="mt-1 text-xs text-zinc-400">
        Point your model client&apos;s base URL at one of these and add the{" "}
        <code className="font-mono text-zinc-300">x-sanction-key</code> header. Every call is metered and capped —
        across providers, one key.
      </p>
      <div className="mt-2 space-y-1.5">
        {PROVIDERS.map((p) => (
          <Row key={p.label} label={p.label} value={p.url} copy={p.url} />
        ))}
        <Row label="Header" value={`x-sanction-key: ${agentKey}`} copy={`x-sanction-key: ${agentKey}`} />
      </div>
    </div>
  )
}
