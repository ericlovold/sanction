"use client"

import { useState } from "react"
import { track } from "@vercel/analytics"
import { GatewayWatch } from "@/components/gateway-watch"

// "Connect your real app" — pick your stack, get one drop-in snippet that works.
// You keep using your own provider key (Sanction forwards it); the x-sanction-key
// header is what meters + caps. Base URLs are tuned per SDK so copy-paste just works
// (OpenAI's SDK needs /v1; Anthropic's already appends it; Gemini uses httpOptions).
const LANGS = ["Node", "Python"] as const
const PROVIDERS = ["OpenAI", "Anthropic", "Gemini"] as const
type Lang = (typeof LANGS)[number]
type Provider = (typeof PROVIDERS)[number]

const INSTALL: Record<Provider, Record<Lang, string>> = {
  OpenAI: { Node: "npm i openai", Python: "pip install openai" },
  Anthropic: { Node: "npm i @anthropic-ai/sdk", Python: "pip install anthropic" },
  Gemini: { Node: "npm i @google/genai", Python: "pip install google-genai" },
}

function snippet(provider: Provider, lang: Lang, key: string): string {
  if (provider === "OpenAI") {
    return lang === "Node"
      ? `import OpenAI from "openai"

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,                 // your OpenAI key — Sanction forwards it
  baseURL: "https://getsanction.com/api/gateway/openai/v1",
  defaultHeaders: { "x-sanction-key": "${key}" },     // meters + caps every call
})

const r = await client.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "Hello from Sanction" }],
})
console.log(r.choices[0].message.content)`
      : `import os
from openai import OpenAI

client = OpenAI(
    api_key=os.environ["OPENAI_API_KEY"],               # your OpenAI key — Sanction forwards it
    base_url="https://getsanction.com/api/gateway/openai/v1",
    default_headers={"x-sanction-key": "${key}"},       # meters + caps every call
)

r = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Hello from Sanction"}],
)
print(r.choices[0].message.content)`
  }
  if (provider === "Anthropic") {
    return lang === "Node"
      ? `import Anthropic from "@anthropic-ai/sdk"

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,              // your Anthropic key — Sanction forwards it
  baseURL: "https://getsanction.com/api/gateway/anthropic",
  defaultHeaders: { "x-sanction-key": "${key}" },     // meters + caps every call
})

const r = await client.messages.create({
  model: "claude-haiku-4-5-20251001",
  max_tokens: 256,
  messages: [{ role: "user", content: "Hello from Sanction" }],
})
console.log(r.content[0].text)`
      : `import os
from anthropic import Anthropic

client = Anthropic(
    api_key=os.environ["ANTHROPIC_API_KEY"],            # your Anthropic key — Sanction forwards it
    base_url="https://getsanction.com/api/gateway/anthropic",
    default_headers={"x-sanction-key": "${key}"},       # meters + caps every call
)

r = client.messages.create(
    model="claude-haiku-4-5-20251001",
    max_tokens=256,
    messages=[{"role": "user", "content": "Hello from Sanction"}],
)
print(r.content[0].text)`
  }
  // Gemini
  return lang === "Node"
    ? `import { GoogleGenAI } from "@google/genai"

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,                 // your Gemini key — Sanction forwards it
  httpOptions: {
    baseUrl: "https://getsanction.com/api/gateway/gemini",
    headers: { "x-sanction-key": "${key}" },          // meters + caps every call
  },
})

const r = await ai.models.generateContent({
  model: "gemini-2.5-flash",
  contents: "Hello from Sanction",
})
console.log(r.text)`
    : `import os
from google import genai
from google.genai import types

client = genai.Client(
    api_key=os.environ["GEMINI_API_KEY"],               # your Gemini key — Sanction forwards it
    http_options=types.HttpOptions(
        base_url="https://getsanction.com/api/gateway/gemini",
        headers={"x-sanction-key": "${key}"},           # meters + caps every call
    ),
)

r = client.models.generate_content(
    model="gemini-2.5-flash",
    contents="Hello from Sanction",
)
print(r.text)`
}

function Copy({ value, onCopy }: { value: string; onCopy?: () => void }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(value)
        onCopy?.()
        setDone(true)
        setTimeout(() => setDone(false), 1200)
      }}
      className="shrink-0 rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-400 transition-colors hover:text-zinc-100"
    >
      {done ? "copied" : "copy"}
    </button>
  )
}

function Toggle<T extends string>({ options, value, onChange }: { options: readonly T[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1 rounded-md border border-zinc-800 bg-zinc-950 p-0.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
            o === value ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  )
}

export function ConnectApp({ agentKey, showWatch = true }: { agentKey: string; showWatch?: boolean }) {
  const [lang, setLang] = useState<Lang>("Node")
  const [provider, setProvider] = useState<Provider>("OpenAI")
  const code = snippet(provider, lang, agentKey)
  const install = INSTALL[provider][lang]

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-400">
        Point your existing SDK at Sanction. You keep your provider key — Sanction just meters and caps every call, across providers, on one key.
      </p>
      <div className="flex flex-wrap gap-2">
        <Toggle options={PROVIDERS} value={provider} onChange={setProvider} />
        <Toggle options={LANGS} value={lang} onChange={setLang} />
      </div>
      <div className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-300">{install}</code>
        <Copy value={install} />
      </div>
      <div>
        <div className="flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-wide text-zinc-500">
            {provider} · {lang}
          </span>
          <Copy value={code} onCopy={() => track("snippet_copied", { provider, lang })} />
        </div>
        <pre className="mt-1 overflow-x-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 text-[11px] leading-relaxed text-zinc-300">
          <code>{code}</code>
        </pre>
      </div>
      {showWatch && <GatewayWatch agentKey={agentKey} />}
    </div>
  )
}
