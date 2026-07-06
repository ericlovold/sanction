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
    <Card className="bg-zinc-900 border-zinc-800">
      <CardHeader className="px-5 pt-5 pb-2">
        <CardTitle className="text-sm font-medium text-zinc-300">Policy packs</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 px-5 pb-5">
        <p className="text-xs text-zinc-600">
          Curated baselines along the governance ladder. Preview replays a pack over your last 30 days before you
          commit; applying replaces the current policy.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          {POLICY_PACKS.map((pack) => (
            <div key={pack.id} className="flex flex-col gap-2 rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-zinc-200">{pack.name}</span>
                <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500">
                  {maturityLabel[pack.maturity]}
                </span>
              </div>
              <p className="text-[11px] leading-relaxed text-zinc-500">{pack.tagline}</p>
              <p className="text-[11px] leading-relaxed text-zinc-600">{pack.audience}</p>
              <div className="mt-auto flex gap-2 pt-1">
                <form action={previewFormAction}>
                  <input type="hidden" name="pack_id" value={pack.id} />
                  <button
                    type="submit"
                    disabled={!editable || previewing}
                    className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-500 disabled:opacity-40"
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
                    className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 transition-colors hover:bg-emerald-400 disabled:opacity-40"
                  >
                    {applying ? "Applying…" : "Apply"}
                  </button>
                </form>
              </div>
            </div>
          ))}
        </div>

        {applyState.message && (
          <p className={`text-xs ${applyState.ok ? "text-emerald-400" : "text-red-400"}`} aria-live="polite">
            {applyState.message}
          </p>
        )}
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
