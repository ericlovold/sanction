"use client"

import { useState, useTransition } from "react"
import { track } from "@vercel/analytics"
import { fmtUsd } from "@/lib/format"
import { FUNNEL } from "@/lib/funnel"
import { decideDemoEscalationAction } from "@/app/dashboard/demo-actions"
import type { DemoEscalation } from "@/lib/demo"

// The landing hero's ten-second moment: a REAL pending escalation from the demo
// wallet, right above the fold. A visitor approves or denies it and immediately
// sees the consequence — a single-use grant minted on a signed record — then
// the ask: want this for your own agents? The decision is real (resolved
// server-side, fires demo_decision with surface="landing"), but the UI is
// optimistic so the confirmation lands instantly and a lost race never shows a
// dead click.
export function LiveEscalation({ initial, startHref }: { initial: DemoEscalation; startHref: string }) {
  const [esc, setEsc] = useState<DemoEscalation>(initial)
  const [decided, setDecided] = useState<null | "approve" | "reject">(null)
  const [, startDecision] = useTransition()

  const decide = (decision: "approve" | "reject") => {
    const id = esc.id
    setDecided(decision) // optimistic — the moment lands now
    startDecision(async () => {
      const res = await decideDemoEscalationAction(id, decision)
      if (res.next) setEsc(res.next) // queue the next one for "try another"
    })
  }

  const another = () => setDecided(null)

  const target = esc.merchant ?? esc.actionType
  const line = esc.amount != null ? `${target} · ${fmtUsd(esc.amount)}` : target

  return (
    <div
      className="sn-card"
      style={{ width: "100%", maxWidth: 420, padding: 0, overflow: "hidden", borderColor: "var(--border-strong, rgba(0,0,0,0.12))" }}
    >
      {/* Header: this is live, not a mockup */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 18px",
          borderBottom: "1px solid var(--border, rgba(0,0,0,0.08))",
          background: "var(--surface-2, rgba(0,0,0,0.02))",
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: 999, background: "var(--pine-7)", boxShadow: "0 0 0 3px color-mix(in srgb, var(--pine-7) 22%, transparent)" }} />
        <span style={{ font: "var(--text-mono-s, 500 11px/1 ui-monospace, monospace)", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-secondary)" }}>
          Live · a real agent is asking
        </span>
      </div>

      {decided === null ? (
        <div style={{ padding: 20 }}>
          <p style={{ margin: 0, font: "var(--text-h3)", lineHeight: 1.35 }}>
            <span style={{ color: "var(--pine-7)" }}>{esc.agent}</span> wants {line}
          </p>
          {esc.reason && (
            <p style={{ margin: "8px 0 0", fontSize: 13.5, lineHeight: 1.5, color: "var(--text-secondary)" }}>{esc.reason}</p>
          )}
          <p style={{ margin: "14px 0 16px", fontSize: 12.5, color: "var(--text-faint)" }}>
            Over the escalation line — it pauses here until a human decides.
          </p>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="sn-btn sn-btn-primary sn-btn-l" style={{ flex: 1 }} onClick={() => decide("approve")}>
              Approve
            </button>
            <button className="sn-btn sn-btn-secondary sn-btn-l" style={{ flex: 1 }} onClick={() => decide("reject")}>
              Deny
            </button>
          </div>
        </div>
      ) : (
        <div style={{ padding: 20 }}>
          <p style={{ margin: 0, font: "var(--text-h3)", lineHeight: 1.35 }}>
            {decided === "approve" ? "Approved." : "Denied."}
          </p>
          <p style={{ margin: "8px 0 0", fontSize: 13.5, lineHeight: 1.5, color: "var(--text-secondary)" }}>
            {decided === "approve"
              ? "A single-use grant was minted on the signed record. The agent retries with it once — and it can't be reused."
              : `It never reached ${esc.merchant ?? "the merchant"}. The block is on the signed record, alongside who decided and when.`}
          </p>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 18 }}>
            <a
              className="sn-btn sn-btn-primary sn-btn-l"
              href={startHref}
              onClick={() => {
                try {
                  track(FUNNEL.landingCta, { location: "live-hero", target: "start" })
                } catch {
                  /* best-effort */
                }
              }}
            >
              Get this for your agents →
            </a>
            <button className="sn-btn sn-btn-ghost sn-btn-l" onClick={another}>
              Try another
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
