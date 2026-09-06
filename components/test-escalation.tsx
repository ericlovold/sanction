"use client"

import { useActionState, useEffect } from "react"
import { track } from "@vercel/analytics"
import { FUNNEL } from "@/lib/funnel"
import { sendTestEscalationAction, type ApprovalActionState } from "@/app/dashboard/approvals/actions"

const initial: ApprovalActionState = { ok: false, message: "" }

/** One-click proof of the approval loop — email, Slack if connected, this inbox. */
export function TestEscalationControl({
  variant = "inbox",
}: {
  variant?: "inbox" | "slack"
}) {
  const [state, action, pending] = useActionState(sendTestEscalationAction, initial)

  useEffect(() => {
    if (state.ok) track(FUNNEL.slackTestEscalationSent)
  }, [state.ok])

  return (
    <form id={variant === "inbox" ? "test-escalation" : undefined} action={action} className="space-y-1">
      <button
        type="submit"
        disabled={pending}
        className={
          variant === "slack"
            ? "inline-flex items-center rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-500 disabled:opacity-60"
            : "inline-flex items-center rounded-md border border-border bg-card px-3 py-2 text-xs font-medium text-foreground transition-colors hover:border-ring disabled:opacity-60"
        }
      >
        {pending ? "Sending…" : "Send a test escalation"}
      </button>
      <p className={variant === "slack" ? "text-[11px] text-zinc-500" : "text-[11px] text-muted-foreground"}>
        {variant === "slack"
          ? "Raises a real $30 escalation on one of your agents so the Approve / Deny card lands in your channel. Anyone in that channel can decide — pick a private channel for approvals."
          : "Raises a real $30 escalation on one of your agents. It emails you and lands in this inbox. Slack is optional."}
      </p>
      {state.message && (
        <p className={`text-xs ${state.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>{state.message}</p>
      )}
    </form>
  )
}
