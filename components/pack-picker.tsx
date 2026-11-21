"use client"

import { useActionState } from "react"
import { POLICY_PACKS, type PolicyPack } from "@/lib/policyPacks"
import {
  applyPackAction,
  previewPackAction,
  type PolicyActionState,
  type SimActionState,
} from "@/app/dashboard/policy/actions"
import { SimulationReport } from "@/components/simulation-report"
import { ActionFlash } from "@/components/ui/action-flash"

const previewInitial: SimActionState = { ok: false, message: "" }
const applyInitial: PolicyActionState = { ok: false, message: "" }

// The four stages, in the order an organization usually takes them. Grouping
// by stage turns twelve templates into one question: how much control now?
const LADDER: Array<{ stage: PolicyPack["maturity"]; label: string; meaning: string }> = [
  { stage: "metering", label: "Measure", meaning: "Everything goes through, everything is counted." },
  { stage: "authorization", label: "Limit", meaning: "Hard ceilings, no approvals to chase." },
  { stage: "governance", label: "Ask", meaning: "A person decides where it matters." },
  { stage: "evidence", label: "Prove", meaning: "Refuse by default and record everything." },
]

// The pack catalog as a conversion surface: preview replays a curated baseline
// over your recorded history (no write); apply installs it (confirm-gated,
// because a pack replaces the whole ladder). Both server actions re-check the
// session, so demo view stays read-only even if the buttons are reached.
// `editable` gates Apply (a write — admin+); `previewable` gates Preview (a
// read-only replay — any signed-in role, viewers included).
export function PackPicker({ editable, previewable = editable, startOpen = false }: {
  editable: boolean
  previewable?: boolean
  // Open the list straight away, for a wallet with no policy yet.
  startOpen?: boolean
}) {
  const [previewState, previewFormAction, previewing] = useActionState(previewPackAction, previewInitial)
  const [applyState, applyFormAction, applying] = useActionState(applyPackAction, applyInitial)

  return (
    <details className="pol-packs" open={startOpen}>
      <summary>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="g-chev" aria-hidden>
          <path d="m9 6 6 6-6 6" />
        </svg>
        <span className="home-h2">
          Start from a template
          <span>{POLICY_PACKS.length}</span>
        </span>
      </summary>
      <p className="pol-lede">
        Ready-made policies. Preview shows what one would have decided over your last 30 days, without changing
        anything. Applying one replaces the whole policy above.
      </p>

      {LADDER.map(({ stage, label, meaning }) => (
        <div key={stage} className="pol-stage">
          <h3>
            {label}
            <span>{meaning}</span>
          </h3>
          <div className="g-panel">
            {POLICY_PACKS.filter((pack) => pack.maturity === stage).map((pack) => (
              <div key={pack.id} className="pol-pack">
                <div style={{ minWidth: 0 }}>
                  <p className="set-title">{pack.name}</p>
                  <p className="set-body">{pack.tagline}</p>
                  <p className="pol-hint">{pack.audience}</p>
                </div>
                <div className="pol-pack-actions">
                  <form action={previewFormAction}>
                    <input type="hidden" name="pack_id" value={pack.id} />
                    <button type="submit" disabled={!previewable || previewing} className="g-btn g-btn-quiet g-btn-sm">
                      {previewing ? "Previewing…" : "Preview"}
                    </button>
                  </form>
                  <form
                    action={applyFormAction}
                    onSubmit={(e) => {
                      if (!window.confirm(`Replace the current policy with "${pack.name}"? This overwrites every governed field.`)) {
                        e.preventDefault()
                      }
                    }}
                  >
                    <input type="hidden" name="pack_id" value={pack.id} />
                    <button type="submit" disabled={!editable || applying} className="g-btn g-btn-primary g-btn-sm">
                      {applying ? "Applying…" : "Apply"}
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Applying is the completed task: announce it, then revert to default. */}
      <ActionFlash state={applyState} />
      {previewState.message && !previewState.ok && (
        <p className="add-pop-error" aria-live="polite">{previewState.message}</p>
      )}
      {previewState.ok && previewState.report && (
        <div className="home-section">
          <SimulationReport report={previewState.report} title={`${previewState.packName ?? "Template"} against your last 30 days`} />
        </div>
      )}
    </details>
  )
}
