"use client"

import { useActionState } from "react"
import { resolveApprovalAction, type ApprovalActionState } from "@/app/dashboard/approvals/actions"

export type PendingApproval = {
  id: string
  merchant: string
  amountUsd: number
  category: string
  action: string
  description: string | null
  agentName: string
  createdAt: string
}

const initial: ApprovalActionState = { ok: false, message: "" }

function ApprovalRow({ a }: { a: PendingApproval }) {
  const [state, formAction, pending] = useActionState(resolveApprovalAction, initial)

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-lg font-semibold text-amber-300">${a.amountUsd.toFixed(2)}</span>
          <span className="truncate text-sm text-zinc-200">{a.merchant}</span>
          <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-500">{a.category}</span>
        </div>
        <p className="mt-1 text-xs text-zinc-600">
          {a.agentName} · {a.action}
          {a.description ? ` · ${a.description}` : ""} · {new Date(a.createdAt).toLocaleString()}
        </p>
      </div>

      <form action={formAction} className="flex items-center gap-2 shrink-0">
        <input type="hidden" name="request_id" value={a.id} />
        {state.message && !state.ok && <span className="text-xs text-red-400">{state.message}</span>}
        <button
          type="submit"
          name="decision"
          value="reject"
          disabled={pending}
          className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:border-red-500/40 hover:text-red-400 disabled:opacity-50"
        >
          Reject
        </button>
        <button
          type="submit"
          name="decision"
          value="approve"
          disabled={pending}
          className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-400 disabled:opacity-50"
        >
          {pending ? "…" : "Approve"}
        </button>
      </form>
    </div>
  )
}

export function ApprovalQueue({ pending }: { pending: PendingApproval[] }) {
  if (pending.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-10 text-center">
        <p className="text-sm text-zinc-400">Nothing waiting</p>
        <p className="mt-1 text-xs text-zinc-600">Charges that exceed the escalation threshold land here for your approval.</p>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {pending.map((a) => (
        <ApprovalRow key={a.id} a={a} />
      ))}
    </div>
  )
}
