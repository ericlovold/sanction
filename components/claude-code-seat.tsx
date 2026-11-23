"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import { track } from "@vercel/analytics"
import { createAgentAction, type CreateAgentState } from "@/app/dashboard/actions"
import { TestEscalationControl } from "@/components/test-escalation"
import { CLAUDE_CODE_CONFIGURE_CHECK, CLAUDE_CODE_INSTALL } from "@/lib/claudeCodePlugin"

const initial: CreateAgentState = { ok: false, error: "" }

function CopyField({ value, label, secret = false }: { value: string; label: string; secret?: boolean }) {
  const [status, setStatus] = useState<"idle" | "pending" | "copied" | "failed">("idle")
  async function copy() {
    if (status === "pending") return
    setStatus("pending")
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable")
      await navigator.clipboard.writeText(value)
      setStatus("copied")
    } catch {
      setStatus("failed")
    }
  }
  return (
    <div>
      <div className="add-pop-key flex items-center gap-3">
        <input
          aria-label={label}
          value={value}
          readOnly
          spellCheck={false}
          autoComplete="off"
          onFocus={(event) => event.currentTarget.select()}
        />
        <button type="button" onClick={copy} disabled={status === "pending"} aria-label={`Copy ${label.toLowerCase()}`} className="g-btn g-btn-quiet g-btn-sm shrink-0">
          {status === "pending" ? "Copying…" : status === "copied" ? "Copied" : "Copy"}
        </button>
      </div>
      {/* The line is reserved, as in the add-agent control, so copying never shifts the layout. */}
      <p role="status" aria-live="polite" className="add-pop-status">
        {status === "copied" ? `${label} copied.` : status === "failed" ? `Copy failed. Select the ${secret ? "key" : "command"} and copy it manually.` : ""}
      </p>
    </div>
  )
}

function Step({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="g-panel home-section space-y-3 p-5">
      <h2 className="home-h2">{title}</h2>
      {children}
    </section>
  )
}

/** Creates a dedicated seat, shows its key once, then walks the install. */
export function ClaudeCodeSeat() {
  const [state, action, pending] = useActionState(createAgentAction, initial)
  const tracked = useRef<string | null>(null)

  useEffect(() => {
    if (state.ok && state.agentKey && tracked.current !== state.agentKey) {
      tracked.current = state.agentKey
      track("agent_created")
    }
  }, [state.ok, state.agentKey])

  if (!state.ok || !state.agentKey) {
    return (
      <Step title="1. Create a seat for this machine">
        <p className="add-pop-note">One seat per machine. Its key identifies this Claude Code install in every approval and audit record.</p>
        <form action={action} className="space-y-3">
          <label className="block space-y-2 text-sm">
            <span className="block">Seat name</span>
            <input name="name" defaultValue="Claude Code" required maxLength={64} className="g-input sm:max-w-sm" />
          </label>
          <button disabled={pending} className="g-btn g-btn-primary">
            {pending ? "Creating…" : "Create seat and show key"}
          </button>
          {state.error && <p role="alert" className="add-pop-error">{state.error}</p>}
        </form>
      </Step>
    )
  }

  return (
    <>
      <Step title={`1. Copy the key for ${state.agentName}`}>
        <p role="status" className="text-sm">Seat created. This key is shown once. Sanction cannot show it again; rotate the seat if you lose it.</p>
        <CopyField value={state.agentKey} label="Agent key" secret />
      </Step>
      <Step title="2. Install the plugin">
        <p className="add-pop-note">Run these in a terminal. Needs Claude Code 2.1.295 or newer and Node 20 or newer.</p>
        {CLAUDE_CODE_INSTALL.map((command, index) => <CopyField key={command} value={command} label={`Command ${index + 1}`} />)}
      </Step>
      <Step title="3. Give the plugin the key">
        <p className="text-sm">Open <code>/plugin</code> in Claude Code. On the <strong>Installed</strong> tab, select Sanction, choose <strong>Configure</strong>, and paste the key from step 1.</p>
        <p className="add-pop-note">To check whether the key is set, run this in a terminal:</p>
        <CopyField value={CLAUDE_CODE_CONFIGURE_CHECK} label="Check command" />
      </Step>
      <Step title="4. Check that approvals reach you">
        <p className="add-pop-note">This tests where approval requests arrive. It does not run Claude Code or prove the plugin is installed.</p>
        <TestEscalationControl agentId={state.agentId} />
      </Step>
      <Step title="5. Try it in Claude Code">
        <p className="text-sm">Ask Claude Code to run <code>git push --dry-run</code> in any repository. The command is blocked until you approve that request. Retry the same command in the same session and working directory, and it runs once.</p>
      </Step>
    </>
  )
}
