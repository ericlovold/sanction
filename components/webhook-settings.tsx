"use client"

import { useActionState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { addWebhookAction, removeWebhookAction, type WebhookActionState } from "@/app/dashboard/approvals/actions"

export type WebhookRow = { id: string; url: string; events: string[] }

const initial: WebhookActionState = { ok: false, message: "" }

export function WebhookSettings({ webhooks, editable }: { webhooks: WebhookRow[]; editable: boolean }) {
  const [state, formAction, pending] = useActionState(addWebhookAction, initial)

  return (
    <Card className="bg-card border-border">
      <CardHeader className="px-5 pt-5 pb-2">
        <CardTitle className="text-sm font-medium text-foreground">Notifications (webhooks)</CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-5 space-y-4">
        <p className="text-xs text-foreground0">
          Get pinged the instant a charge escalates. Slack URLs get readable messages automatically; other
          endpoints get signed JSON (verify <code className="font-mono">x-sanction-signature</code>). Add
          multiple routes with different subscriptions to send approvals and budget alerts to different channels.
        </p>

        {webhooks.length > 0 && (
          <div className="space-y-2">
            {webhooks.map((w) => (
              <div key={w.id} className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs text-foreground">{w.url}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {w.events.map((e) => (
                      <span key={e} className="rounded border border-border bg-card px-1.5 py-0.5 text-[10px] text-foreground0">
                        {e === "*" ? "everything" : e}
                      </span>
                    ))}
                  </div>
                </div>
                {editable && (
                  <form action={removeWebhookAction}>
                    <input type="hidden" name="id" value={w.id} />
                    <button type="submit" className="shrink-0 rounded border border-input px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-red-400">
                      Remove
                    </button>
                  </form>
                )}
              </div>
            ))}
          </div>
        )}
        {webhooks.length === 0 && <p className="text-sm text-muted-foreground">No webhooks yet.</p>}

        {editable ? (
          <form action={formAction} className="space-y-3">
            <div className="flex gap-2">
              <input
                name="url"
                type="url"
                required
                placeholder="https://hooks.slack.com/… or any https endpoint"
                className="min-w-0 flex-1 rounded-md border border-border bg-card px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-ring"
              />
              <button
                type="submit"
                disabled={pending}
                className="shrink-0 rounded-md bg-signal px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {pending ? "Adding…" : "Add"}
              </button>
            </div>

            {/* Per-channel routing: pick what this route hears. Send approvals
                to #approvals and budget alerts to #finance by adding two routes
                with different subscriptions. */}
            <fieldset className="rounded-md border border-border bg-muted/40 px-3 py-2.5">
              <legend className="px-1 text-[11px] uppercase tracking-wide text-foreground0">This route receives</legend>
              <div className="grid gap-x-6 gap-y-1.5 text-xs text-muted-foreground sm:grid-cols-3">
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="events" value="approval.created" defaultChecked className="accent-signal" />
                  Approval requested
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="events" value="approval.resolved" defaultChecked className="accent-signal" />
                  Approval resolved
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="events" value="budget.threshold" defaultChecked className="accent-signal" />
                  Budget at 80%
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="events" value="budget.exhausted" className="accent-signal" />
                  Budget exhausted
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="events" value="escalation.created" defaultChecked className="accent-signal" />
                  Escalation opened
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="events" value="escalation.resolved" defaultChecked className="accent-signal" />
                  Escalation resolved
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="events" value="report.weekly_digest" className="accent-signal" />
                  Weekly digest (Mondays)
                </label>
                <label className="flex items-center gap-2 text-foreground">
                  <input type="checkbox" name="events" value="*" className="accent-signal" />
                  Everything (present and future)
                </label>
              </div>
            </fieldset>
            {state.message && (
              <p className={`text-xs ${state.ok ? "text-signal" : "text-red-400"}`}>{state.message}</p>
            )}
            {state.ok && state.secret && (
              <div className="rounded-md border border-ochre/25 bg-ochre/10 px-3 py-2">
                <p className="text-[11px] text-ochre">Signing secret — shown once. Verify the signature with it:</p>
                <code className="mt-1 block break-all font-mono text-[11px] text-foreground">{state.secret}</code>
              </div>
            )}
          </form>
        ) : (
          <p className="text-xs text-muted-foreground">
            <a href="/login" className="text-signal hover:text-signal">Log in</a> to add notifications.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
