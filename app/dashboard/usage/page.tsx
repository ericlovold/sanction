import Link from "next/link"
import { getViewWallet } from "@/lib/session"
import { NoWallet } from "@/components/no-wallet"
import { usageView } from "@/lib/usageView"
import { sourceNames, type UsageSource } from "@/lib/usageObservation"

export const dynamic = "force-dynamic"
export const metadata = { title: "Developer usage | Sanction" }
const date = (value: Date | null) => value ? value.toISOString().replace("T", " ").slice(0, 19) + " UTC" : "Unknown"

export default async function UsagePage() {
  const wallet = await getViewWallet()
  if (!wallet) return <NoWallet />
  const view = await usageView(wallet.id)
  return <div className="mx-auto max-w-6xl space-y-8 p-5 md:p-10">
    <header className="space-y-3">
      <Link href="/dashboard" className="text-sm text-muted-foreground underline">Back to roster</Link>
      <h1 className="text-3xl font-semibold tracking-tight">Developer usage</h1>
      <p className="text-muted-foreground">Claude Code and Codex activity reported to {wallet.name}.</p>
      <p className="max-w-3xl text-sm text-muted-foreground">Observation only. These events do not stop execution or billing. Estimates are separate from governed spend and subscription charges. Coverage depends on each client exporting events.</p>
    </header>
    <section className="grid gap-4 md:grid-cols-2" aria-label="Connection coverage">
      {view.connections.map(c => <article key={c.source} className="space-y-3 rounded-lg border p-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-medium">{sourceNames[c.source]}</h2><span className="rounded border px-2 py-1 text-xs">Observation only</span></div>
        <p className="font-medium">{c.status}</p>
        <dl className="space-y-1 text-xs text-muted-foreground"><div>Last delivery: {date(c.receivedAt)}</div><div>Latest event: {date(c.occurredAt)}</div></dl>
        <p className="text-xs text-muted-foreground">No recent delivery can mean idle, offline, or unconfigured. It does not mean zero usage.</p>
      </article>)}
    </section>
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3"><h2 className="text-xl font-medium">Sessions · last 7 days</h2><a href="/dashboard/usage" className="text-sm underline">Refresh</a></div>
      {view.truncated && <p className="text-sm text-amber-600">Showing the most recent 1,000 events. Session totals below are partial.</p>}
      {!view.sessions.length ? <div className="rounded-lg border p-6"><p>No session events in this window.</p><p className="mt-2 text-sm text-muted-foreground">Connect a client below and run a task. An empty feed is not evidence of zero activity.</p></div> :
        <div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[700px] text-left text-sm">
          <thead className="border-b bg-muted/30"><tr>{["Session / seat", "Tool", "Model calls", "Input / output tokens", "Reported estimate"].map(s => <th className="px-4 py-3 font-medium" key={s}>{s}</th>)}</tr></thead>
          <tbody>{view.sessions.map(s => <tr key={s.key} className="border-b last:border-0">
            <td className="px-4 py-4"><p>{s.seat}</p><p className="font-mono text-xs" title={s.sessionId}>{s.sessionId.slice(0, 20)}</p><p className="mt-1 text-xs text-muted-foreground">{date(s.lastEvent)}</p></td>
            <td className="px-4 py-4">{sourceNames[s.source as UsageSource]}</td>
            <td className="px-4 py-4">{s.modelCalls}</td>
            <td className="px-4 py-4">{s.modelCalls && s.unmeteredCalls < s.modelCalls ? `${s.tokensIn.toLocaleString()} / ${s.tokensOut.toLocaleString()}${s.unmeteredCalls ? " · partial" : ""}` : "Unavailable"}</td>
            <td className="px-4 py-4">{!s.modelCalls || s.unpricedCalls === s.modelCalls ? "Unavailable" : `$${s.estimatedCost.toFixed(4)}${s.unpricedCalls ? " · partial" : ""}`}</td>
          </tr>)}</tbody>
        </table></div>}
      <p className="text-xs text-muted-foreground">Client-reported values, not invoices. Claude cache tokens are stored separately; Codex cached tokens are included in its input count. Unknown prices remain unavailable.</p>
    </section>
    <section className="space-y-3 rounded-lg border p-5">
      <h2 className="text-xl font-medium">Connect your tools</h2>
      <p className="text-sm text-muted-foreground">Use a dedicated seat key for each client. Configure native OTLP HTTP JSON logs, then run a task and refresh this page. Keep prompt and tool-detail export disabled.</p>
      <div className="flex flex-wrap gap-4 text-sm underline"><Link href="/dashboard/agents">Create a seat</Link><Link href="/docs/developer-usage">Setup and approval test</Link><Link href="/dashboard/approvals">Review approvals</Link></div>
      <p className="text-xs text-muted-foreground">The optional Claude Code hook gates configured tool calls. Receiving telemetry does not prove the hook is installed or enforcing.</p>
    </section>
  </div>
}
