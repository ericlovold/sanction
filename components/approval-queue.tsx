"use client"

import { useOptimistic, useActionState, useEffect, useRef, useState } from "react"
import { Check, Plus, X } from "lucide-react"
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
    stringValue(a.resource.tool) ??
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

// One plain-language sentence: what approving DOES. Replaces the escalation-code
// and grant-summary boxes — the operator decides on consequences, not codes.
function consequence(a: PendingApproval) {
  const constraints = a.constraints ?? {}
  const oneUse = constraints.one_use === true ? "one-use " : ""
  const ttl = numberValue(constraints.grant_ttl_mins)
  const ttlText = ttl !== null ? `, expires in ${ttl}m` : ""
  const amount = money(a.resource.amount_usd)

  if (a.resource.kind === "spend") {
    const merchant = stringValue(a.resource.merchant)
    return `Approving issues a ${oneUse}${amount ? `${amount} ` : ""}grant${merchant ? ` for ${merchant}` : ""} to ${a.agentName}${ttlText}.`
  }
  if (a.resource.kind === "provision") {
    const quantity = numberValue(a.resource.quantity)
    const lineItem = stringValue(a.resource.line_item)
    const what = lineItem ? `${quantity !== null ? `${quantity} × ` : ""}${lineItem}` : "this provision"
    return `Approving issues a ${oneUse}grant for ${what}${amount ? ` (${amount})` : ""} to ${a.agentName}${ttlText}.`
  }
  if (a.resource.kind === "tool") {
    const tool = stringValue(a.resource.tool) ?? "this tool"
    return `Approving issues a ${oneUse}grant letting ${a.agentName} invoke ${tool}${ttlText}.`
  }
  return `Approving grants ${a.agentName} this authority${ttlText}.`
}

// Short label for the armed confirm button: the amount if there is one.
function confirmLabel(a: PendingApproval) {
  const amount = money(a.resource.amount_usd)
  return amount ? `Confirm ${amount}` : "Confirm approve"
}

function ApprovalRow({
  a,
  editable,
  onResolve,
}: {
  a: PendingApproval
  editable: boolean
  onResolve: (id: string) => void
}) {
  const [state, formAction, pending] = useActionState(resolveApprovalAction, initial)
  // Two-step confirm on Approve only: first tap arms for 3s, second tap submits.
  // Reject stays one-tap — denying is safe by default.
  const [armed, setArmed] = useState(false)
  const disarmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [noteOpen, setNoteOpen] = useState(false)
  const details = approvalDetails(a)

  useEffect(
    () => () => {
      if (disarmTimer.current) clearTimeout(disarmTimer.current)
    },
    [],
  )

  function arm() {
    setArmed(true)
    if (disarmTimer.current) clearTimeout(disarmTimer.current)
    disarmTimer.current = setTimeout(() => setArmed(false), 3000)
  }

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-sm border border-border px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
            {labelActionType(a.actionType)}
          </span>
          <span className="min-w-0 truncate text-sm font-medium text-foreground">{approvalTitle(a)}</span>
        </div>
        <p className="mt-1 font-mono text-xs text-muted-foreground">
          {a.agentName} · {a.reason ?? "Needs approval"} · {new Date(a.createdAt).toLocaleString()}
        </p>
        {details && <p className="mt-1 text-xs text-muted-foreground">{details}</p>}
        <p className="mt-2 text-xs text-muted-foreground">{consequence(a)}</p>
      </div>

      {editable ? (
        <form
          action={(fd) => {
            // Optimistically clear the card the moment a decision is submitted;
            // if the action fails, the transition settles without a state change
            // and the card returns carrying the error message.
            onResolve(a.id)
            formAction(fd)
          }}
          className="mt-4 flex flex-col gap-3 border-t border-border pt-3"
        >
          <input type="hidden" name="approval_id" value={a.id} />
          {noteOpen ? (
            <input
              name="note"
              autoFocus
              placeholder="Approval note"
              className="min-h-11 rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring"
            />
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {!noteOpen ? (
                <button
                  type="button"
                  onClick={() => setNoteOpen(true)}
                  className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Plus className="size-3" />
                  Add note
                </button>
              ) : null}
              {state.message && !state.ok ? <span className="text-xs text-destructive">{state.message}</span> : null}
            </div>
            <div className="flex items-center gap-3">
              <button
                type="submit"
                name="decision"
                value="reject"
                disabled={pending}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border px-4 text-sm font-medium text-foreground transition-colors hover:border-destructive/50 hover:text-destructive disabled:opacity-50"
              >
                <X className="size-4" />
                Reject
              </button>
              {armed ? (
                <button
                  type="submit"
                  name="decision"
                  value="approve"
                  disabled={pending}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  <Check className="size-4" />
                  {pending ? "..." : confirmLabel(a)}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={arm}
                  disabled={pending}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  <Check className="size-4" />
                  Approve
                </button>
              )}
            </div>
          </div>
        </form>
      ) : (
        <a
          href="/login"
          className="mt-4 inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        >
          Log in to manage
        </a>
      )}
    </div>
  )
}

export function ApprovalQueue({ pending, editable }: { pending: PendingApproval[]; editable: boolean }) {
  // Optimistic list: a submitted decision removes its card immediately; the
  // server action + revalidation settle the real state behind it.
  const [visible, removeOptimistic] = useOptimistic(pending, (current, id: string) =>
    current.filter((a) => a.id !== id),
  )

  if (visible.length === 0) {
    return (
      <div className="rounded-md border border-border bg-card p-10 text-center">
        <p className="text-sm text-muted-foreground">Nothing waiting</p>
        <p className="mt-1 font-mono text-xs text-muted-foreground">
          When an agent&apos;s request crosses your policy&apos;s escalation line it lands here, and the agent
          waits on your decision. Add a webhook below to get pinged the moment that happens.
        </p>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {visible.map((a) => (
        <ApprovalRow key={a.id} a={a} editable={editable} onResolve={removeOptimistic} />
      ))}
    </div>
  )
}
