"use client"

import { useRef, useState } from "react"
import { track } from "@vercel/analytics"

type PreviewDecision = "approve" | "deny"

export function ApprovalPreview() {
  const [decision, setDecision] = useState<PreviewDecision | null>(null)
  const tracked = useRef(false)

  function decide(next: PreviewDecision) {
    setDecision(next)
    if (!tracked.current) {
      tracked.current = true
      track("onboarding_preview_decision", { decision: next })
    }
  }

  return (
    <section
      aria-labelledby="approval-preview-title"
      className="rounded-lg border p-5 sm:p-6"
      style={{ borderColor: "var(--paper-3)", borderTop: "2px solid var(--ochre-6)", background: "var(--surface-card)" }}
    >
      <p className="sn-mono text-xs" style={{ color: "var(--ochre-7)" }}>INTERACTIVE PREVIEW</p>
      <h2 id="approval-preview-title" className="mt-2 text-xl font-semibold">Your agent wants to send an email.</h2>
      <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
        Try a decision on this fictional request. This preview never sends email or saves an approval.
      </p>

      <dl className="mt-5 space-y-3 border-y py-4 text-sm" style={{ borderColor: "var(--paper-3)" }}>
        <div>
          <dt style={{ color: "var(--text-secondary)" }}>Proposed action</dt>
          <dd className="mt-1 font-medium">Send one external email</dd>
        </div>
        <div>
          <dt style={{ color: "var(--text-secondary)" }}>Recipient</dt>
          <dd className="mt-1 break-all font-mono">reviewer@example.com</dd>
        </div>
        <div>
          <dt style={{ color: "var(--text-secondary)" }}>Subject</dt>
          <dd className="mt-1 font-medium">Draft project update for review</dd>
        </div>
        <div>
          <dt style={{ color: "var(--text-secondary)" }}>Message</dt>
          <dd className="mt-1">The project draft is ready. Please review it before Friday.</dd>
        </div>
      </dl>

      <div role="status" aria-live="polite" aria-atomic="true" className="mt-4">
        <p className="font-semibold">
          {decision === null ? "Waiting for your decision" : decision === "approve" ? "Preview: permission granted" : "Preview: permission denied"}
        </p>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          {decision === null
            ? "In this example, the agent pauses before sending. Review the recipient and message, then approve or deny the proposed action."
            : decision === "approve"
              ? "Approval would permit this exact action. Your connected agent would still need to execute it through its email tool. Nothing was sent here."
              : "Denial would keep this action blocked. Your connected agent must honor the denial and stop. Nothing was sent here."}
        </p>
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" className="sn-btn sn-btn-primary sn-btn-m disabled:opacity-50" disabled={decision !== null} onClick={() => decide("approve")}>
          Approve
        </button>
        <button type="button" className="sn-btn sn-btn-secondary sn-btn-m disabled:opacity-50" disabled={decision !== null} onClick={() => decide("deny")}>
          Deny
        </button>
        {decision !== null && (
          <button type="button" className="sn-btn sn-btn-ghost sn-btn-m" onClick={() => setDecision(null)}>
            Reset preview
          </button>
        )}
      </div>
    </section>
  )
}
