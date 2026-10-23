"use client"

import { useActionState, useId, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import { createWalletAction, type CreateState } from "@/app/start/actions"
import { ConnectApp } from "@/components/connect-app"
import { Disclosure } from "@/components/disclosure"

const initial: CreateState = { ok: false, error: "" }

type CopyState = {
  pending: boolean
  start: () => boolean
  finish: () => void
}

function Copy({ value, label, copyState }: { value: string; label: string; copyState: CopyState }) {
  const [status, setStatus] = useState<"idle" | "pending" | "copied" | "failed">("idle")

  async function copy() {
    if (!copyState.start()) return
    setStatus("pending")
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable")
      await navigator.clipboard.writeText(value)
      setStatus("copied")
    } catch {
      setStatus("failed")
    } finally {
      copyState.finish()
    }
  }

  return (
    <div className="min-w-0 text-right">
      <button
        type="button"
        onClick={copy}
        disabled={copyState.pending}
        aria-label={`Copy ${label}`}
        className="sanction-link shrink-0 rounded border px-2 py-1 text-[11px] transition-colors disabled:opacity-50"
        style={{ borderColor: "var(--paper-3)" }}
      >
        {status === "pending" ? "copying…" : status === "copied" ? "copied" : "copy"}
      </button>
      <span role="status" aria-live="polite" aria-atomic="true" className={status === "failed" ? "mt-1 block text-xs" : "sr-only"}>
        {status === "copied" ? `${label} copied.` : status === "failed" ? "Copy failed. Select the text and copy it manually." : ""}
      </span>
    </div>
  )
}

function Field({ label, value, hint, copyState }: { label: string; value: string; hint?: string; copyState: CopyState }) {
  const id = useId()
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-1">
        <label htmlFor={id} className="text-[11px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>{label}</label>
        {hint && <span className="text-[10px]" style={{ color: "var(--status-escalated)" }}>{hint}</span>}
      </div>
      <div className="mt-1 rounded-md border px-2.5 py-1.5" style={{ borderColor: "var(--paper-3)", background: "var(--paper-1)" }}>
        <input
          id={id}
          value={value}
          readOnly
          spellCheck={false}
          autoComplete="off"
          onFocus={(event) => event.currentTarget.select()}
          className="block w-full min-w-0 bg-transparent font-mono text-base sm:text-xs"
          style={{ color: "var(--text-body)" }}
        />
        <Copy value={value} label={label} copyState={copyState} />
      </div>
      <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>Select the field to copy the full value manually.</p>
    </div>
  )
}

export function CreateWallet({ intro }: { intro?: ReactNode }) {
  const [state, formAction, pending] = useActionState(createWalletAction, initial)
  const copyLock = useRef(false)
  const [copyPending, setCopyPending] = useState(false)
  const copyState: CopyState = {
    pending: copyPending,
    start: () => {
      if (copyLock.current) return false
      copyLock.current = true
      setCopyPending(true)
      return true
    },
    finish: () => {
      copyLock.current = false
      setCopyPending(false)
    },
  }
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
          Your workspace is ready. Save these keys before leaving this page — they are shown only once.
        </div>
        <Field label="Agent key (x-api-key — for authorize, tokens)" value={state.agentKey} copyState={copyState} />
        <Field label="Management key (x-mgmt-key — gates policy, agents, approvals)" value={state.managementKey} hint="most sensitive" copyState={copyState} />
        <Field label="Wallet ID" value={state.walletId} copyState={copyState} />

        <div className="rounded-lg border-l-2 p-5" style={{ borderColor: "var(--ochre-6)", background: "var(--ochre-tint)" }}>
          <h2 className="text-lg font-semibold">Next: connect your AI tool.</h2>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            Choose your tool and send a harmless test request. You review the exact action
            in Sanction before deciding. No purchase is needed.
          </p>
          <Link href="/docs/connect" className="sn-btn sn-btn-primary sn-btn-m mt-4">Connect my tool →</Link>
          <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
            Your agent must ask Sanction and honor the answer. Connecting does not intercept its other tools.
          </p>
        </div>

        <h2 className="pt-2 text-sm font-semibold">Building your own integration?</h2>
        <Disclosure summary="Connect your app — drop-in SDK snippet" variant="light">
          <ConnectApp agentKey={state.agentKey} variant="light" />
        </Disclosure>

        <Disclosure summary="Prefer raw HTTP? Copy the curl" variant="light">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>authorize — one call</span>
            <Copy value={tryCurl} label="curl command" copyState={copyState} />
          </div>
          <pre className="mt-1 overflow-x-auto rounded-md border p-3 text-[11px] leading-relaxed" style={{ borderColor: "var(--paper-3)", background: "var(--paper-1)", color: "var(--text-body)" }}>
            <code>{tryCurl}</code>
          </pre>
        </Disclosure>

        <Disclosure summary="Use it from an MCP host (Claude Desktop, agent runtimes)" variant="light">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>MCP config</span>
            <Copy value={mcp} label="MCP configuration" copyState={copyState} />
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
    <>
    {intro}
    <form id="create-workspace-form" action={formAction} className="space-y-4">
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
      <div aria-live="polite" aria-atomic="true">
        {state.error && (
          <div className="space-y-2 text-sm">
            <p className="text-red-400">{state.error}</p>
            {state.code === "WORKSPACE_EXISTS" && (
              <>
                <p style={{ color: "var(--text-secondary)" }}>
                  Sign in to your existing workspace with an email link, Google, GitHub, or your management key.
                </p>
                <Link href="/login" className="sanction-link inline-block">Sign in to my workspace →</Link>
              </>
            )}
          </div>
        )}
      </div>
      <button
        type="submit"
        disabled={pending}
        className="sn-btn sn-btn-primary sn-btn-m w-full disabled:opacity-50"
      >
        {pending ? "Creating…" : "Create my workspace"}
      </button>
      <p className="text-center text-[11px]" style={{ color: "var(--text-muted)" }}>Free for individuals. No card required. Save your access keys on the next screen.</p>
    </form>
        <p className="mt-6 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          Already have an account? <Link href="/login" className="sanction-link">Sign in</Link>
        </p>
    </>
  )
}
