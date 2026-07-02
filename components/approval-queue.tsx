"use client"

import { useActionState } from "react"
import { Check, Clock3, FileText, X } from "lucide-react"
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
  if (a.resource.kind === "provision") {
    const quantity = numberValue(a.resource.quantity)
    const lineItem = stringValue(a.resource.line_item) ?? "Unknown item"
    const amount = money(a.resource.amount_usd)
    const resource = stringValue(a.resource.resource)
    const head = quantity === null ? lineItem : `${quantity} × ${lineItem}`
    return `${head}${amount ? ` — ${amount}` : ""}${resource ? ` (${resource})` : ""}`
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
  const unitPrice = a.resource.kind === "provision" ? money(a.resource.unit_price_usd) : null
  const details = [
    stringValue(a.resource.category),
    stringValue(a.resource.action),
    unitPrice ? `${unitPrice}/unit` : null,
    stringValue(a.resource.description),
    a.expiresAt ? `expires ${new Date(a.expiresAt).toLocaleString()}` : null,
  ]
  return details.filter(Boolean).join(" · ")
}

function grantSummary(a: PendingApproval) {
  const constraints = a.constraints ?? {}
  const pieces = []
  if (constraints.one_use === true) pieces.push("one use")
  const ttl = numberValue(constraints.grant_ttl_mins)
  if (ttl !== null) pieces.push(`${ttl}m grant`)
  const amount = money(a.resource.amount_usd)
  if (amount) pieces.push(amount)
  const target = stringValue(a.resource.merchant) ?? stringValue(a.resource.line_item)
  if (target) pieces.push(target)
  return pieces.join(" · ")
}

function ApprovalRow({ a, editable }: { a: PendingApproval; editable: boolean }) {
  const [state, formAction, pending] = useActionState(resolveApprovalAction, initial)
  const details = approvalDetails(a)
  const grant = grantSummary(a)

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
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
        <div className="grid gap-2 text-xs sm:grid-cols-2 lg:min-w-[340px]">
          <div className="rounded-md border border-amber-500/20 bg-amber-500/[0.04] px-3 py-2">
            <p className="flex items-center gap-1.5 text-amber-200">
              <Clock3 className="size-3" />
              Escalation
            </p>
            <p className="mt-1 text-zinc-500">{a.code ?? "ESCALATION_REQUIRED"}</p>
          </div>
          <div className="rounded-md border border-emerald-500/20 bg-emerald-500/[0.04] px-3 py-2">
            <p className="flex items-center gap-1.5 text-emerald-200">
              <FileText className="size-3" />
              Grant
            </p>
            <p className="mt-1 text-zinc-500">{grant || "approval-bound"}</p>
          </div>
        </div>
      </div>

      {editable ? (
        <form action={formAction} className="mt-4 flex flex-col gap-3 border-t border-zinc-800 pt-3">
          <input type="hidden" name="approval_id" value={a.id} />
          <input
            name="note"
            placeholder="Approval note"
            className="min-h-9 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-zinc-600"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            {state.message && !state.ok ? <span className="text-xs text-red-400">{state.message}</span> : <span />}
            <div className="flex items-center gap-2">
              <button
                type="submit"
                name="decision"
                value="reject"
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:border-red-500/40 hover:text-red-400 disabled:opacity-50"
              >
                <X className="size-3.5" />
                Reject
              </button>
              <button
                type="submit"
                name="decision"
                value="approve"
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-400 disabled:opacity-50"
              >
                <Check className="size-3.5" />
                {pending ? "..." : "Approve"}
              </button>
            </div>
          </div>
        </form>
      ) : (
        <a href="/login" className="mt-4 inline-flex rounded-md border border-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800">
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
        <p className="mt-1 text-xs text-zinc-600">No pending human decisions.</p>
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
