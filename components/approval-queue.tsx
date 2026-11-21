"use client"

import type { ReactNode } from "react"
import { useOptimistic, useActionState, useEffect, useRef, useState } from "react"
import { Check, Plus, X } from "lucide-react"
import { reviewToolRequestAction, resolveApprovalAction, type ApprovalActionState } from "@/app/dashboard/approvals/actions"
import { EmptyState } from "@/components/ui/empty-state"
import { kindLabel, numberValue, resourceTitle, stringValue } from "@/lib/approvalTitle"
import { fmtUsd } from "@/lib/format"

export type PendingApproval = {
  id: string
  /** the AuthorizationRequest id — what escalation emails deep-link with (?review=) */
  sourceId: string | null
  actionType: string
  reason: string | null
  code: string | null
  subject: Record<string, unknown>
  resource: Record<string, unknown>
  constraints: Record<string, unknown> | null
  agentName: string
  createdAt: string
  expiresAt: string | null
  /** Set when this escalation belongs to a pool below the viewer's wallet —
   *  rendered as a provenance badge so a merged inbox still shows where it came
   *  from. Null/absent for the viewer's own wallet. */
  poolName?: string | null
}

const initial: ApprovalActionState = { ok: false, message: "" }

function money(value: unknown) {
  const n = numberValue(value)
  return n === null ? null : fmtUsd(n)
}

// "3 hr ago" / "in 11 min", measured from the server's clock (`now`) so the
// server render and the browser agree.
function span(ms: number) {
  const mins = Math.max(0, Math.round(Math.abs(ms) / 60_000))
  if (mins < 1) return "under a minute"
  if (mins < 60) return `${mins} min`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours} hr`
  return `${Math.round(hours / 24)} days`
}

function approvalDetails(a: PendingApproval) {
  const unitPrice = a.resource.kind === "provision" ? money(a.resource.unit_price_usd) : null
  const details = [
    stringValue(a.resource.category),
    stringValue(a.resource.action),
    unitPrice ? `${unitPrice}/unit` : null,
    stringValue(a.resource.description),
  ]
  return details.filter(Boolean).join(", ")
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
    return `Approving issues a ${oneUse}grant letting ${a.agentName} attempt ${tool} with the reviewed arguments${ttlText}.`
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
  now,
  onResolve,
}: {
  a: PendingApproval
  editable: boolean
  now: number
  onResolve: (id: string) => void
}) {
  const [state, formAction, pending] = useActionState(resolveApprovalAction, initial)
  // Two-step confirm on Approve only: first tap arms for 3s, second tap submits.
  // Reject stays one-tap — denying is safe by default.
  const [armed, setArmed] = useState(false)
  const disarmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [noteOpen, setNoteOpen] = useState(false)
  const [review, setReview] = useState<{ request?: string; error?: string }>({})
  const [reviewing, setReviewing] = useState(false)
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

  const leftMs = a.expiresAt ? new Date(a.expiresAt).getTime() - now : null
  const urgent = leftMs !== null && leftMs <= 15 * 60_000

  return (
    <article className="appr g-glass">
      <div className="appr-body">
        <div className="appr-top">
          <h3 className="appr-title">
            <span className="wait-dot" aria-hidden />
            <span>{resourceTitle(a.resource, a.actionType)}</span>
          </h3>
          {leftMs !== null && (
            <span className={`appr-deadline${urgent ? " appr-deadline-soon" : ""}`}>
              {leftMs <= 0 ? "Deadline passed" : `Expires in ${span(leftMs)}`}
            </span>
          )}
        </div>
        <p className="appr-who">
          {kindLabel(a.resource, a.actionType)} asked by {a.agentName}
          {a.poolName ? ` in ${a.poolName}` : ""}, {span(now - new Date(a.createdAt).getTime())} ago
        </p>
        <dl className="appr-facts">
          <div>
            <dt>Why it stopped</dt>
            <dd>{a.reason ?? "Needs approval"}</dd>
          </div>
          {details && (
            <div>
              <dt>Details</dt>
              <dd>{details}</dd>
            </div>
          )}
        </dl>
        {editable && a.resource.kind === "tool" ? (
          <div className="appr-exact">
            <button type="button" disabled={reviewing} className="home-link" onClick={async () => {
              setReviewing(true)
              try { setReview(await reviewToolRequestAction(a.id)) }
              catch { setReview({ error: "Request review failed. Try again." }) }
              finally { setReviewing(false) }
            }}>{reviewing ? "Loading request…" : "Review exact request"}</button>
            {review.request ? <pre className="appr-pre">{JSON.stringify(JSON.parse(review.request), null, 2)}</pre> : null}
            {review.error ? <p className="add-pop-error">{review.error}</p> : null}
          </div>
        ) : null}
        <p className="appr-effect">{consequence(a)}</p>
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
          className="appr-actions"
        >
          <input type="hidden" name="approval_id" value={a.id} />
          {noteOpen ? (
            <input name="note" autoFocus placeholder="Add a note to the record" aria-label="Note" className="g-input appr-note" />
          ) : null}
          <div className="appr-buttons">
            <div className="appr-left">
              {!noteOpen ? (
                <button type="button" onClick={() => setNoteOpen(true)} className="g-btn g-btn-quiet g-btn-sm">
                  <Plus className="size-3.5" />
                  Add note
                </button>
              ) : null}
              {state.message && !state.ok ? <span className="add-pop-error" style={{ margin: 0 }}>{state.message}</span> : null}
            </div>
            <div className="appr-right">
              <button type="submit" name="decision" value="reject" disabled={pending} className="g-btn g-btn-quiet">
                <X className="size-4" />
                Reject
              </button>
              {/* The two buttons carry different keys on purpose. Without them React
                  reuses one DOM button and flips its type to "submit" while the
                  first click is still being handled, so the browser submits the
                  form and a single click approves. Distinct keys make React swap
                  the element, and the first click only arms. */}
              {armed ? (
                <button key="confirm" type="submit" name="decision" value="approve" disabled={pending} className="g-btn g-btn-primary">
                  <Check className="size-4" />
                  {pending ? "..." : confirmLabel(a)}
                </button>
              ) : (
                <button key="arm" type="button" onClick={arm} disabled={pending} className="g-btn g-btn-primary">
                  <Check className="size-4" />
                  Approve
                </button>
              )}
            </div>
          </div>
        </form>
      ) : (
        <div className="appr-actions">
          <a href="/login" className="g-btn g-btn-quiet" style={{ alignSelf: "flex-start" }}>
            Log in to decide
          </a>
        </div>
      )}
    </article>
  )
}

export function ApprovalQueue({
  pending,
  editable,
  focusId,
  now,
  empty,
}: {
  pending: PendingApproval[]
  editable: boolean
  focusId?: string
  // The server's clock at render, so "3 hr ago" matches on both sides.
  now?: number
  empty?: { title: string; hint: string; action?: ReactNode }
}) {
  // Optimistic list: a submitted decision removes its card immediately; the
  // server action + revalidation settle the real state behind it.
  const [visible, removeOptimistic] = useOptimistic(pending, (current, id: string) =>
    current.filter((a) => a.id !== id),
  )

  // Email deep link: bring the reader to the exact decision they were asked
  // for. The link carries the request id; resolve it to the approval card.
  useEffect(() => {
    if (!focusId) return
    const match = pending.find((a) => a.id === focusId || a.sourceId === focusId)
    if (!match) return
    document.getElementById(`approval-${match.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })
  }, [focusId, pending])

  // Fallback for callers that do not pass the server clock: fixed at mount.
  const [mountedAt] = useState(() => Date.now())
  const clock = now ?? mountedAt

  if (visible.length === 0) {
    const title = empty?.title ?? "Nothing waiting"
    const hint =
      empty?.hint ??
      "When an agent's request crosses your policy's escalation line it lands here, and the agent waits on your decision."
    return <EmptyState title={title} hint={hint} action={empty?.action} />
  }
  return (
    <div className="appr-list">
      {visible.map((a) => (
        <div
          key={a.id}
          id={`approval-${a.id}`}
          className={focusId && (a.id === focusId || a.sourceId === focusId) ? "appr-focus" : undefined}
        >
          <ApprovalRow a={a} editable={editable} now={clock} onResolve={removeOptimistic} />
        </div>
      ))}
    </div>
  )
}
