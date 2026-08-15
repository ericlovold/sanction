"use client"

import { useActionState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  addWebhookAction,
  removeWebhookAction,
  revokeSlackInstallAction,
  type WebhookActionState,
} from "@/app/dashboard/approvals/actions"

export type WebhookRow = { id: string; url: string; events: string[] }
export type SlackInstallRow = {
  id: string
  teamName: string | null
  channelName: string | null
  channelId: string
}

const initial: WebhookActionState = { ok: false, message: "" }

const SLACK_STATUS: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "Slack connected. Escalations will land in the channel you picked." },
  denied: { ok: false, text: "Slack install was cancelled." },
  forbidden: { ok: false, text: "Admin role required to connect Slack." },
  invalid: { ok: false, text: "Slack install expired. Try Add to Slack again." },
  failed: { ok: false, text: "Slack did not return a bot token. Check the app's OAuth scopes." },
  missing_channel: { ok: false, text: "Slack did not return a channel. Reinstall and pick a channel." },
}

export function WebhookSettings({
  webhooks,
  slackInstalls = [],
  oauthEnabled = false,
  slackStatus,
  editable,
}: {
  webhooks: WebhookRow[]
  slackInstalls?: SlackInstallRow[]
  oauthEnabled?: boolean
  slackStatus?: string
  editable: boolean
}) {
  const [state, formAction, pending] = useActionState(addWebhookAction, initial)
  const status = slackStatus ? SLACK_STATUS[slackStatus] : undefined

  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardHeader className="px-5 pt-5 pb-2">
        <CardTitle className="text-sm font-medium text-zinc-300">Notifications (webhooks)</CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-5 space-y-4">
        <p className="text-xs text-zinc-500">
          Get pinged the instant a charge escalates. Add to Slack posts Approve/Deny in the channel
          you pick at install. Incoming webhooks still deep-link only. Other endpoints get signed
          JSON (verify <code className="font-mono">x-sanction-signature</code>).
        </p>

        {status && (
          <p className={`text-xs ${status.ok ? "text-emerald-400" : "text-red-400"}`}>{status.text}</p>
        )}

        {slackInstalls.length > 0 && (
          <div className="space-y-2">
            {slackInstalls.map((row) => (
              <div
                key={row.id}
                className="flex items-center justify-between gap-3 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs text-zinc-300">
                    {row.teamName ?? "Slack workspace"}
                    <span className="text-zinc-500">
                      {" "}
                      · {row.channelName ? row.channelName : `#${row.channelId}`}
                    </span>
                  </p>
                  <p className="mt-0.5 text-[10px] text-zinc-500">Approve / Deny in Slack</p>
                </div>
                {editable && (
                  <form action={revokeSlackInstallAction}>
                    <input type="hidden" name="id" value={row.id} />
                    <button
                      type="submit"
                      className="shrink-0 rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-400 transition-colors hover:text-red-400"
                    >
                      Disconnect
                    </button>
                  </form>
                )}
              </div>
            ))}
          </div>
        )}

        {editable && oauthEnabled && (
          <a
            href="/api/slack/oauth/start"
            className="inline-flex items-center rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-500"
          >
            Add to Slack
          </a>
        )}

        {webhooks.length > 0 && (
          <div className="space-y-2">
            {webhooks.map((w) => (
              <div key={w.id} className="flex items-center justify-between gap-3 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs text-zinc-300">{w.url}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {w.events.map((e) => (
                      <span key={e} className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-500">
                        {e === "*" ? "everything" : e}
                      </span>
                    ))}
                  </div>
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
        {webhooks.length === 0 && slackInstalls.length === 0 && (
          <p className="text-sm text-zinc-600">No webhooks yet.</p>
        )}

        {editable ? (
          <form action={formAction} className="space-y-3">
            <div className="flex gap-2">
              <input
                name="url"
                type="url"
                required
                placeholder="https://hooks.slack.com/…, https://slack.com/archives/C…, or any https endpoint"
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

            {/* Per-channel routing: pick what this route hears. Send approvals
                to #approvals and budget alerts to #finance by adding two routes
                with different subscriptions. */}
            <fieldset className="rounded-md border border-zinc-800 bg-zinc-950/50 px-3 py-2.5">
              <legend className="px-1 text-[11px] uppercase tracking-wide text-zinc-500">This route receives</legend>
              <div className="grid gap-x-6 gap-y-1.5 text-xs text-zinc-400 sm:grid-cols-3">
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="events" value="approval.created" defaultChecked className="accent-emerald-500" />
                  Approval requested
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="events" value="approval.resolved" defaultChecked className="accent-emerald-500" />
                  Approval resolved
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="events" value="budget.threshold" defaultChecked className="accent-emerald-500" />
                  Budget at 80%
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="events" value="budget.exhausted" className="accent-emerald-500" />
                  Budget exhausted
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="events" value="escalation.created" defaultChecked className="accent-emerald-500" />
                  Escalation opened
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="events" value="escalation.resolved" defaultChecked className="accent-emerald-500" />
                  Escalation resolved
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="events" value="report.weekly_digest" className="accent-emerald-500" />
                  Weekly digest (Mondays)
                </label>
                <label className="flex items-center gap-2 text-zinc-300">
                  <input type="checkbox" name="events" value="*" className="accent-emerald-500" />
                  Everything (present and future)
                </label>
              </div>
            </fieldset>
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
