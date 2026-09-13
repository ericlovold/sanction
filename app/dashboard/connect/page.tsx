import Link from "next/link"
import { getViewWallet } from "@/lib/session"
import { NoWallet } from "@/components/no-wallet"
import { ConnectionConfig } from "@/components/connection-config"
import { developerConfig, developerConnection } from "@/lib/developerConnection"
import { hasRole } from "@/lib/roles"
import { sourceNames } from "@/lib/usageObservation"

export const dynamic = "force-dynamic"
export const metadata = { title: "Connect a developer tool | Sanction" }
const date = (value: Date) => value.toISOString().replace("T", " ").slice(0, 19) + " UTC"

export default async function ConnectPage({ searchParams }: {
  searchParams: Promise<{ source?: string; seat?: string; check?: string }>
}) {
  const wallet = await getViewWallet()
  if (!wallet) return <NoWallet />
  if (!wallet.isSession) return <div className="p-6"><Link href="/login?next=%2Fdashboard%2Fconnect" className="underline">Sign in to connect your own tool</Link></div>
  const params = await searchParams
  const check = typeof params.check === "string" && /^\d{1,6}$/.test(params.check) ? Number(params.check) + 1 : 1
  const source = params.source === "codex" ? "codex" : "claude-code"
  const seat = typeof params.seat === "string" ? params.seat : ""
  const view = await developerConnection(wallet.id, seat, source)
  return <div className="mx-auto max-w-3xl space-y-7 p-5 md:p-10">
    <header className="space-y-3">
      <Link href="/dashboard" className="text-sm underline">Back to roster</Link>
      <h1 className="text-3xl font-semibold">Connect a developer tool</h1>
      <p className="text-muted-foreground">Choose a tool, configure its exporter, then check delivery to {wallet.name}.</p>
      <p className="text-sm">This connects usage reporting. It does not stop tool execution, model calls, or subscription auto-refills.</p>
    </header>
    <section className="space-y-4 rounded-lg border p-5">
      <h2 className="text-xl font-medium">1. Choose your tool and seat</h2>
      <p className="text-sm text-muted-foreground">Use a dedicated seat per client. Only active, unexpired seats in this wallet are listed.</p>
      <form action="/dashboard/connect" method="get" className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-2 text-sm"><span className="block">Tool</span><select name="source" defaultValue={source} className="w-full rounded border bg-background p-2"><option value="claude-code">Claude Code</option><option value="codex">Codex (local client)</option></select></label>
          <label className="space-y-2 text-sm"><span className="block">Seat</span><select name="seat" defaultValue={view.selected?.id ?? ""} required className="w-full rounded border bg-background p-2"><option value="" disabled>Choose a seat</option>{view.agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
        </div>
        <button className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground" disabled={!view.agents.length}>Show setup</button>
      </form>
      {seat && !view.selected && <p role="alert" className="text-sm">That seat is unavailable in this wallet. Choose an active seat.</p>}
      {!view.agents.length && <p className="text-sm">No active seats are available.</p>}
      {hasRole(wallet.role, "admin") ? <Link className="inline-block text-sm underline" href="/dashboard/agents">Create or manage seats</Link> : <p className="text-sm text-muted-foreground">Ask a wallet admin to create a dedicated seat and provide its key.</p>}
    </section>
    {view.selected && <>
      <section className="space-y-4 rounded-lg border p-5">
        <h2 className="text-xl font-medium">2. Configure {sourceNames[source]}</h2>
        <p className="text-sm">Use the saved key for <strong>{view.selected.name}</strong>. Keys are shown only when created or rotated; Sanction cannot recover them here.</p>
        {source === "claude-code" ? <p className="text-sm text-muted-foreground">Set SANCTION_AGENT_KEY locally to that seat’s key, then run this in the terminal that launches Claude Code. Review any existing exporter settings: these variables change where logs are sent.</p> : <p className="text-sm text-muted-foreground">Merge this into your private ~/.codex/config.toml. Replace YOUR_SEAT_KEY locally. Do not duplicate an existing [otel] table or commit the key in project configuration.</p>}
        <ConnectionConfig key={source + view.selected.id} text={developerConfig(source)} />
        <p className="text-xs text-muted-foreground">Keep prompt and tool-detail export disabled. Native exporters may send extra fields in transit; Sanction discards unneeded fields and does not retain raw envelopes.</p>
      </section>
      <section id="delivery" className="scroll-mt-28 space-y-4 rounded-lg border p-5">
        <h2 className="text-xl font-medium">3. Run a task and check delivery</h2>
        <p className="text-sm">Start a new {sourceNames[source]} process with this configuration, run a small task, and allow the exporter to flush. Then check below.</p>
        <div role="status" className="space-y-2">
          <p className="font-medium">{!view.latest ? "No events received for this seat and tool" : view.recent ? "Recent delivery received for this seat and tool" : "Past delivery found; no recent delivery"}</p>
          {view.latest && <dl className="text-sm text-muted-foreground"><div>Last delivery: {date(view.latest.receivedAt)}</div><div>Original event time: {date(view.latest.occurredAt)}</div></dl>}
          <p className="text-xs text-muted-foreground">Recent means within 15 minutes. Delivery can come from an older session or delayed export; it does not verify this configuration or an enforcement hook.</p>
        </div>
        <form action="/dashboard/connect#delivery" method="get">
          <input type="hidden" name="check" value={check} />
          <input type="hidden" name="source" value={source} /><input type="hidden" name="seat" value={seat} />
          <button className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground">Check again</button>
        </form>
        <details className="text-sm"><summary className="cursor-pointer">Nothing arriving?</summary><ul className="mt-3 list-disc space-y-2 pl-5"><li>Confirm the key belongs to the selected seat and has not been revoked or rotated.</li><li>Restart the client after editing configuration. Check for administrator overrides.</li><li>Use OTLP HTTP JSON logs at the exact endpoint above. Compressed exports are not supported.</li><li>Allow time for export and check local exporter errors. No delivery can also mean the client is idle or offline.</li></ul></details>
        <Link href="/dashboard/usage" className="block text-sm underline">View reported sessions</Link>
      </section>
      <section className="space-y-3 rounded-lg border p-5">
        <h2 className="text-xl font-medium">Next: choose what to govern</h2>
        {source === "claude-code" ? <><p className="text-sm text-muted-foreground">The optional Claude Code approval test gates a configured Read call. It uses a dedicated test wallet and policy; reporting alone does not install it.</p><Link href="/docs/developer-usage" className="text-sm underline">Set up the native approval test</Link></> : <><p className="text-sm text-muted-foreground">This Codex connection observes usage. To enforce limits, route supported model calls through the gateway or MCP tool calls through the broker.</p><Link href="/docs/gateway" className="mr-4 text-sm underline">Gateway setup</Link><Link href="/docs/agent-wallet" className="text-sm underline">MCP broker setup</Link></>}
      </section>
    </>}
  </div>
}
