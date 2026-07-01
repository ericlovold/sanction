"use client"

import { useActionState, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { updatePolicyAction, type PolicyActionState } from "@/app/dashboard/spend/actions"

type PolicyDollars = {
  daily_token_budget_usd: number
  daily_spend_budget_usd: number
  subtree_daily_cap_usd: number | null
  per_transaction_max_usd: number
  auto_approve_under_usd: number
  escalate_over_usd: number
  allowed_categories: string[]
  blocked_categories: string[]
}

const fields = [
  { name: "daily_token_budget_usd", label: "Daily token budget" },
  { name: "daily_spend_budget_usd", label: "Daily spend budget" },
  { name: "subtree_daily_cap_usd", label: "Subtree daily cap", optional: true },
  { name: "per_transaction_max_usd", label: "Per-transaction max" },
  { name: "auto_approve_under_usd", label: "Auto-approve under" },
  { name: "escalate_over_usd", label: "Escalate over" },
] as const

const initial: PolicyActionState = { ok: false, message: "" }

export function PolicyEditor({ policy, editable }: { policy: PolicyDollars; editable: boolean }) {
  const [state, formAction, pending] = useActionState(updatePolicyAction, initial)
  const [perTxn, setPerTxn] = useState(policy.per_transaction_max_usd)
  const [escalate, setEscalate] = useState(policy.escalate_over_usd)
  const escalationDead = escalate >= perTxn

  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardHeader className="px-5 pt-5 pb-2">
        <CardTitle className="text-sm font-medium text-zinc-300">Policy</CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        <form action={formAction} className="space-y-5">
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            {fields.map((f) => (
              <label key={f.name} className="block">
                <span className="text-[11px] uppercase tracking-wide text-zinc-600">{f.label}</span>
                <div className="mt-1 flex items-center rounded-md border border-zinc-800 bg-zinc-950 focus-within:border-zinc-600">
                  <span className="pl-2.5 font-mono text-sm text-zinc-600">$</span>
                  <input
                    type="number"
                    name={f.name}
                    step="0.01"
                    min="0"
                    disabled={!editable}
                    defaultValue={policy[f.name] ?? ""}
                    placeholder={"optional" in f && f.optional ? "No cap" : undefined}
                    onChange={
                      f.name === "per_transaction_max_usd"
                        ? (e) => setPerTxn(Number(e.target.value))
                        : f.name === "escalate_over_usd"
                          ? (e) => setEscalate(Number(e.target.value))
                          : undefined
                    }
                    className="w-full bg-transparent px-2 py-1.5 font-mono text-sm text-zinc-100 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
              </label>
            ))}
          </div>

          {escalationDead && (
            <p className="rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-400">
              Escalation will never trigger: a charge has to clear &ldquo;Per-transaction max&rdquo; before it can
              escalate, so set &ldquo;Escalate over&rdquo; below it for human approval to be reachable.
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-[11px] uppercase tracking-wide text-zinc-600">Allowed categories</span>
              <input
                name="allowed_categories"
                disabled={!editable}
                defaultValue={policy.allowed_categories.join(", ")}
                placeholder="software, services, research"
                className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 font-mono text-sm text-zinc-100 outline-none focus:border-zinc-600"
              />
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-wide text-zinc-600">Blocked categories</span>
              <input
                name="blocked_categories"
                disabled={!editable}
                defaultValue={policy.blocked_categories.join(", ")}
                placeholder="gambling, adult, crypto"
                className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 font-mono text-sm text-red-300 outline-none focus:border-zinc-600"
              />
            </label>
          </div>

          {editable ? (
            <div className="flex items-center justify-between gap-3">
              <span
                className={`text-xs ${state.message ? (state.ok ? "text-emerald-400" : "text-red-400") : "text-transparent"}`}
                aria-live="polite"
              >
                {state.message || "."}
              </span>
              <button
                type="submit"
                disabled={pending}
                className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-400 disabled:opacity-50"
              >
                {pending ? "Saving…" : "Save policy"}
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-zinc-500">Viewing the demo — log in to edit your own policy.</span>
              <a href="/login" className="rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800">
                Log in
              </a>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  )
}
