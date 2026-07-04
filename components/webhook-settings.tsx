"use client"

import { useActionState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { addWebhookAction, removeWebhookAction, type WebhookActionState } from "@/app/dashboard/approvals/actions"

export type WebhookRow = { id: string; url: string; events: string[] }

const initial: WebhookActionState = { ok: false, message: "" }

export function WebhookSettings({ webhooks, editable }: { webhooks: WebhookRow[]; editable: boolean }) {
  const [state, formAction, pending] = useActionState(addWebhookAction, initial)

  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardHeader className="px-5 pt-5 pb-2">
        <CardTitle className="text-sm font-medium text-zinc-300">Notifications (webhooks)</CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-5 space-y-4">
        <p className="text-xs text-zinc-500">
          Get pinged the instant a charge escalates — wire this to Slack, email, or PagerDuty.
          We POST a signed JSON payload; verify the <code className="font-mono">x-sanction-signature</code> header.
        </p>

        {webhooks.length > 0 && (
          <div className="space-y-2">
            {webhooks.map((w) => (
              <div key={w.id} className="flex items-center justify-between gap-3 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs text-zinc-300">{w.url}</p>
                  <p className="text-[10px] text-zinc-600">{w.events.join(" · ")}</p>
                </div>
                {editable && (
                  <form action={removeWebhookAction}>
                    <input type="hidden" name="id" value={w.id} />
                    <button type="submit" className="shrink-0 rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-400 transition-colors hover:text-red-400">
                      Remove
                    </button>
                  </form>
                )}
              </div>
            ))}
          </div>
        )}
        {webhooks.length === 0 && <p className="text-sm text-zinc-600">No webhooks yet.</p>}

        {editable ? (
          <form action={formAction} className="space-y-2">
            <div className="flex gap-2">
              <input
                name="url"
                type="url"
                required
                placeholder="https://hooks.slack.com/… or any https endpoint"
                className="min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-100 outline-none focus:border-zinc-600"
              />
              <button
                type="submit"
                disabled={pending}
                className="shrink-0 rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-400 disabled:opacity-50"
              >
                {pending ? "Adding…" : "Add"}
              </button>
            </div>
            {state.message && (
              <p className={`text-xs ${state.ok ? "text-emerald-400" : "text-red-400"}`}>{state.message}</p>
            )}
            {state.ok && state.secret && (
              <div className="rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2">
                <p className="text-[11px] text-amber-300">Signing secret — shown once. Verify the signature with it:</p>
                <code className="mt-1 block break-all font-mono text-[11px] text-zinc-200">{state.secret}</code>
              </div>
            )}
          </form>
        ) : (
          <p className="text-xs text-zinc-600">
            <a href="/login" className="text-emerald-400 hover:text-emerald-300">Log in</a> to add notifications.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
