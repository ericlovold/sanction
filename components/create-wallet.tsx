"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import { track } from "@vercel/analytics"
import Link from "next/link"
import { createWalletAction, type CreateState } from "@/app/start/actions"
import { TestDecision } from "@/components/test-decision"
import { ConnectApp } from "@/components/connect-app"
import { Disclosure } from "@/components/disclosure"

const initial: CreateState = { ok: false, error: "" }

function Copy({ value }: { value: string }) {
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

function Field({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</span>
        {hint && <span className="text-[10px] text-amber-400/80">{hint}</span>}
      </div>
      <div className="mt-1 flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-200">{value}</code>
        <Copy value={value} />
      </div>
    </div>
  )
}

export function CreateWallet() {
  const [state, formAction, pending] = useActionState(createWalletAction, initial)
  const tracked = useRef(false)

  useEffect(() => {
    if (state.ok && !tracked.current) {
      tracked.current = true
      track("wallet_created")
    }
  }, [state.ok])

  if (state.ok) {
    const mcp = JSON.stringify(
      { mcpServers: { sanction: { command: "npx", args: ["sanction-mcp"], env: { SANCTION_API_KEY: state.agentKey, SANCTION_WALLET_ID: state.walletId } } } },
      null,
      2,
    )
    const tryCurl = `curl -X POST https://getsanction.com/api/v1/authorize \\
  -H "x-api-key: ${state.agentKey}" \\
  -H "content-type: application/json" \\
  -d '{"action":"purchase","amount_usd":5,"merchant":"OpenAI","category":"software"}'`
    return (
      <div className="space-y-5">
        <div className="rounded-md border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          Save these now — the keys are shown once and never again.
        </div>
        <Field label="Agent key (x-api-key — for authorize, tokens)" value={state.agentKey} />
        <Field label="Management key (x-mgmt-key — gates policy, agents, approvals)" value={state.managementKey} hint="most sensitive" />
        <Field label="Wallet ID" value={state.walletId} />

        {/* The aha: run a real decision in-browser — no setup, no agent needed */}
        <TestDecision agentKey={state.agentKey} />

        <Disclosure summary="Connect your app — drop-in SDK snippet">
          <ConnectApp agentKey={state.agentKey} />
        </Disclosure>

        <Disclosure summary="Prefer raw HTTP? Copy the curl">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wide text-zinc-500">authorize — one call</span>
            <Copy value={tryCurl} />
          </div>
          <pre className="mt-1 overflow-x-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 text-[11px] leading-relaxed text-zinc-300">
            <code>{tryCurl}</code>
          </pre>
        </Disclosure>

        <Disclosure summary="Use it from an MCP host (Claude Desktop, agent runtimes)">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wide text-zinc-500">MCP config</span>
            <Copy value={mcp} />
          </div>
          <pre className="mt-1 overflow-x-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 text-[11px] leading-relaxed text-zinc-300">
            <code>{mcp}</code>
          </pre>
          <p className="mt-2 text-xs text-zinc-500">
            Set budgets &amp; categories via <code className="font-mono text-zinc-400">PATCH /api/v1/wallets/policy</code> with your management key.
          </p>
        </Disclosure>

        <div className="flex items-center gap-3 pt-1">
          <Link href="/dashboard" className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-400">
            Open my dashboard →
          </Link>
          <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-300">Back to home</Link>
        </div>
        <p className="text-[11px] text-zinc-600">
          You&apos;re signed in on this device. To return later, go to <span className="font-mono">/login</span> and paste your management key.
        </p>
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-4">
      <label className="block">
        <span className="text-[11px] uppercase tracking-wide text-zinc-500">Workspace name</span>
        <input
          name="name"
          required
          maxLength={64}
          placeholder="Acme Agents"
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-600"
        />
      </label>
      <label className="block">
        <span className="text-[11px] uppercase tracking-wide text-zinc-500">Email</span>
        <input
          name="email"
          type="email"
          required
          placeholder="you@company.com"
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-600"
        />
      </label>
      {!state.ok && state.error && <p className="text-sm text-red-400">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-400 disabled:opacity-50"
      >
        {pending ? "Creating…" : "Create wallet — free"}
      </button>
      <p className="text-center text-[11px] text-zinc-600">No card required. You&apos;ll get an agent key and a management key.</p>
    </form>
  )
}
