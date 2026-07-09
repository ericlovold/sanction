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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

const previewInitial: SimActionState = { ok: false, message: "" }
const applyInitial: PolicyActionState = { ok: false, message: "" }

const maturityLabel: Record<PolicyPack["maturity"], string> = {
  metering: "Metering",
  authorization: "Authorization",
  governance: "Governance",
  evidence: "Evidence",
}

// The pack catalog as a conversion surface: preview replays a curated baseline
// over your recorded history (no write); apply installs it (confirm-gated,
// because a pack replaces the whole ladder). Both server actions re-check the
// session, so demo view stays read-only even if the buttons are reached.
export function PackPicker({ editable }: { editable: boolean }) {
  const [previewState, previewFormAction, previewing] = useActionState(previewPackAction, previewInitial)
  const [applyState, applyFormAction, applying] = useActionState(applyPackAction, applyInitial)

  return (
    <Card className="bg-card border-border">
      <CardHeader className="px-5 pt-5 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">Policy packs</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 px-5 pb-5">
        <p className="text-xs text-muted-foreground">
          Curated baselines along the governance ladder. Preview replays a pack over your last 30 days before you
          commit; applying replaces the current policy.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          {POLICY_PACKS.map((pack) => (
            <div key={pack.id} className="flex flex-col gap-2 rounded-md border border-border bg-muted p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-foreground">{pack.name}</span>
                <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {maturityLabel[pack.maturity]}
                </span>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">{pack.tagline}</p>
              <p className="text-[11px] leading-relaxed text-muted-foreground">{pack.audience}</p>
              <div className="mt-auto flex gap-2 pt-1">
                <form action={previewFormAction}>
                  <input type="hidden" name="pack_id" value={pack.id} />
                  <button
                    type="submit"
                    disabled={!editable || previewing}
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-border disabled:opacity-40"
                  >
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
                  <button
                    type="submit"
                    disabled={!editable || applying}
                    className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-emerald-400 disabled:opacity-40"
                  >
                    {applying ? "Applying…" : "Apply"}
                  </button>
                </form>
              </div>
            </div>
          ))}
        </div>

        {/* Applying is the completed task — announce it, then revert to default. */}
        <ActionFlash state={applyState} />
        {previewState.message && !previewState.ok && (
          <p className="text-xs text-red-400" aria-live="polite">{previewState.message}</p>
        )}
        {previewState.ok && previewState.report && (
          <SimulationReport
            report={previewState.report}
            title={`Preview — ${previewState.packName ?? "pack"} vs. your last 30 days`}
          />
        )}
      </CardContent>
    </Card>
  )
}
