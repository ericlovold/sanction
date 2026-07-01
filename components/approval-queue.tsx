"use client"

import { useActionState } from "react"
import { resolveApprovalAction, type ApprovalActionState } from "@/app/dashboard/approvals/actions"

export type PendingApproval = {
  id: string
  actionType: string
  reason: string | null
  code: string | null
  subject: Record<string, unknown>
  resource: Record<string, unknown>
  constraints: Record<string, unknown> | null
  agentName: string
  createdAt: string
  expiresAt: string | null
}

const initial: ApprovalActionState = { ok: false, message: "" }

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function labelActionType(actionType: string) {
  return actionType
    .split(".")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function money(value: unknown) {
  const n = numberValue(value)
  return n === null ? null : `$${n.toFixed(2)}`
}

function approvalTitle(a: PendingApproval) {
  if (a.resource.kind === "spend") {
    const amount = money(a.resource.amount_usd)
    const merchant = stringValue(a.resource.merchant) ?? "Unknown merchant"
    return amount ? `${amount} ${merchant}` : merchant
  }
  return (
    stringValue(a.resource.label) ??
    stringValue(a.resource.tool_name) ??
    stringValue(a.resource.credential_label) ??
    stringValue(a.resource.name) ??
    labelActionType(a.actionType)
  )
}

function approvalDetails(a: PendingApproval) {
  const details = [
    stringValue(a.resource.category),
    stringValue(a.resource.action),
    stringValue(a.resource.description),
    a.expiresAt ? `expires ${new Date(a.expiresAt).toLocaleString()}` : null,
  ]
  return details.filter(Boolean).join(" · ")
}

function ApprovalRow({ a, editable }: { a: PendingApproval; editable: boolean }) {
  const [state, formAction, pending] = useActionState(resolveApprovalAction, initial)
  const details = approvalDetails(a)

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500">
            {labelActionType(a.actionType)}
          </span>
          <span className="min-w-0 truncate text-sm font-medium text-zinc-200">{approvalTitle(a)}</span>
        </div>
        <p className="mt-1 text-xs text-zinc-600">
          {a.agentName} · {a.reason ?? "Needs approval"} · {new Date(a.createdAt).toLocaleString()}
        </p>
        {details && <p className="mt-1 text-xs text-zinc-500">{details}</p>}
      </div>

      {editable ? (
        <form action={formAction} className="flex items-center gap-2 shrink-0">
          <input type="hidden" name="approval_id" value={a.id} />
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
            {pending ? "..." : "Approve"}
          </button>
        </form>
      ) : (
        <a href="/login" className="shrink-0 rounded-md border border-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800">
          Log in to manage
        </a>
      )}
    </div>
  )
}

export function ApprovalQueue({ pending, editable }: { pending: PendingApproval[]; editable: boolean }) {
  if (pending.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-10 text-center">
        <p className="text-sm text-zinc-400">Nothing waiting</p>
        <p className="mt-1 text-xs text-zinc-600">Agent requests that need a human decision land here.</p>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {pending.map((a) => (
        <ApprovalRow key={a.id} a={a} editable={editable} />
      ))}
    </div>
  )
}
