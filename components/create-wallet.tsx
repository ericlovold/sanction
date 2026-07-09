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
      className="sanction-link shrink-0 rounded border px-2 py-1 text-[11px] transition-colors"
      style={{ borderColor: "var(--paper-3)" }}
    >
      {done ? "copied" : "copy"}
    </button>
  )
}

function Field({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>{label}</span>
        {hint && <span className="text-[10px]" style={{ color: "var(--status-escalated)" }}>{hint}</span>}
      </div>
      <div className="mt-1 flex items-center gap-2 rounded-md border px-2.5 py-1.5" style={{ borderColor: "var(--paper-3)", background: "var(--paper-1)" }}>
        <code className="min-w-0 flex-1 truncate font-mono text-xs" style={{ color: "var(--text-body)" }}>{value}</code>
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
        <div className="rounded-md border px-4 py-3 text-sm" style={{ borderColor: "var(--status-escalated)", background: "var(--status-escalated-bg)", color: "var(--text-body)" }}>
          Save these now — the keys are shown once and never again.
        </div>
        <Field label="Agent key (x-api-key — for authorize, tokens)" value={state.agentKey} />
        <Field label="Management key (x-mgmt-key — gates policy, agents, approvals)" value={state.managementKey} hint="most sensitive" />
        <Field label="Wallet ID" value={state.walletId} />

        {/* The aha: run a real decision in-browser — no setup, no agent needed */}
        <TestDecision agentKey={state.agentKey} variant="light" />

        <Disclosure summary="Connect your app — drop-in SDK snippet" variant="light">
          <ConnectApp agentKey={state.agentKey} variant="light" />
        </Disclosure>

        <Disclosure summary="Prefer raw HTTP? Copy the curl" variant="light">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>authorize — one call</span>
            <Copy value={tryCurl} />
          </div>
          <pre className="mt-1 overflow-x-auto rounded-md border p-3 text-[11px] leading-relaxed" style={{ borderColor: "var(--paper-3)", background: "var(--paper-1)", color: "var(--text-body)" }}>
            <code>{tryCurl}</code>
          </pre>
        </Disclosure>

        <Disclosure summary="Use it from an MCP host (Claude Desktop, agent runtimes)" variant="light">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>MCP config</span>
            <Copy value={mcp} />
          </div>
          <pre className="mt-1 overflow-x-auto rounded-md border p-3 text-[11px] leading-relaxed" style={{ borderColor: "var(--paper-3)", background: "var(--paper-1)", color: "var(--text-body)" }}>
            <code>{mcp}</code>
          </pre>
          <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
            Set budgets &amp; categories via <code className="font-mono" style={{ color: "var(--text-secondary)" }}>PATCH /api/v1/wallets/policy</code> with your management key.
          </p>
        </Disclosure>

        <div className="flex items-center gap-3 pt-1">
          <Link href="/dashboard" className="sn-btn sn-btn-primary sn-btn-m">
            Open my dashboard →
          </Link>
          <Link href="/" className="sanction-link text-sm">Back to home</Link>
        </div>
        <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          You&apos;re signed in on this device. To return later, go to <span className="font-mono">/login</span> and paste your management key.
        </p>
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-4">
      <label className="block">
        <span className="text-[11px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Workspace name</span>
        <input
          name="name"
          required
          maxLength={64}
          placeholder="Acme Agents"
          className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none"
          style={{ borderColor: "var(--paper-3)", background: "var(--surface-card)", color: "var(--text-body)" }}
        />
      </label>
      <label className="block">
        <span className="text-[11px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Email</span>
        <input
          name="email"
          type="email"
          required
          placeholder="you@company.com"
          className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none"
          style={{ borderColor: "var(--paper-3)", background: "var(--surface-card)", color: "var(--text-body)" }}
        />
      </label>
      {!state.ok && state.error && <p className="text-sm text-red-400">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="sn-btn sn-btn-primary sn-btn-m w-full disabled:opacity-50"
      >
        {pending ? "Creating…" : "Create wallet — free"}
      </button>
      <p className="text-center text-[11px]" style={{ color: "var(--text-muted)" }}>No card required. You&apos;ll get an agent key and a management key.</p>
    </form>
  )
}
