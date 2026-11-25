import type { Metadata } from "next"
import Link from "next/link"
import { NoWallet } from "@/components/no-wallet"
import { BrandIcon } from "@/components/brand-icon"
import { getViewWallet } from "@/lib/session"
import { hasRole } from "@/lib/roles"
import { homeOverview } from "@/lib/homeOverview"
import { TOOL_CATALOG, pickedTools, type ConnectionMethod } from "@/lib/toolCatalog"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Your AI tools | Sanction",
  description: "Pick the AI tools you use. Only the ones you connect show on your dashboard.",
}

const BUCKET: Record<ConnectionMethod["bucket"], string> = {
  admin_usage: "Provider usage records",
  api_key: "Calls through Sanction",
  local_collector: "Reports from each machine",
  billing_export: "Billing export upload",
}

function history(days: number): string {
  return days > 0 ? `Brings in the last ${days} days` : "From the moment you connect"
}

// Step 1 picks tools (a plain GET form, so the choice lives in the URL and
// nothing is stored). Step 2 shows each picked tool's ways to connect, with
// what each can and cannot show stated before any key is pasted.
export default async function ToolsPage({ searchParams }: { searchParams: Promise<{ tool?: string | string[] }> }) {
  const [view, params] = await Promise.all([getViewWallet(), searchParams])
  if (!view) return <NoWallet />
  const canConnect = view.isSession && hasRole(view.role, "admin")
  const picked = pickedTools(params.tool)
  const overview = await homeOverview(view.id)
  const connected = new Map(
    overview.view.kind === "tools" ? overview.view.tools.map((t) => [t.id, new Set(t.methods.map((m) => m.label))]) : [],
  )

  return (
    <div className="home" style={{ maxWidth: 880 }}>
      <h1 className="home-title">Your AI tools</h1>
      <p className="home-sub">Pick what you use. Only the tools you connect show on your dashboard.</p>

      <form method="get" className="g-panel home-section p-5">
        <h2 className="home-h2">1. Which tools do you use?</h2>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 md:grid-cols-4">
          {TOOL_CATALOG.map((tool) => (
            <label key={tool.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm has-[:checked]:border-primary">
              <input type="checkbox" name="tool" value={tool.id} defaultChecked={picked.some((p) => p.id === tool.id)} className="accent-current" />
              <BrandIcon brand={tool.brand} label={tool.name} size={20} />
              <span>{tool.name}</span>
              {connected.has(tool.id) && <span className="ml-auto text-[11px] text-emerald-500">Connected</span>}
            </label>
          ))}
        </div>
        <button type="submit" className="g-btn g-btn-primary mt-4">Show how to connect</button>
      </form>

      {picked.length > 0 && (
        <section className="home-section space-y-4" aria-labelledby="connect-picked">
          <h2 id="connect-picked" className="home-h2">2. Connect them</h2>
          {picked.map((tool) => (
            <article key={tool.id} className="g-panel p-5">
              <h3 className="flex items-center gap-2 font-medium">
                <BrandIcon brand={tool.brand} label={tool.name} size={24} />
                {tool.name}
              </h3>
              <ul className="mt-3 divide-y divide-border">
                {tool.methods.map((m) => {
                  const isConnected = connected.get(tool.id)?.has(m.label) ?? false
                  return (
                    <li key={m.label} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
                      <div className="min-w-0 max-w-xl space-y-1">
                        <p className="font-medium">
                          {m.label} <span className="text-xs font-normal text-muted-foreground">· {BUCKET[m.bucket]}</span>
                        </p>
                        <p>{m.shows}.</p>
                        <p className="text-xs text-muted-foreground">Cannot show: {m.cannotShow}</p>
                        <p className="text-xs text-muted-foreground">
                          {history(m.historyDays)} · {m.canEnforce ? "Can hold spend to budgets" : "Read-only"}
                        </p>
                      </div>
                      {!m.built ? (
                        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">Not built yet</span>
                      ) : isConnected ? (
                        <Link href={m.href!} className="g-btn g-btn-sm">Manage</Link>
                      ) : canConnect ? (
                        <Link href={m.href!} className="g-btn g-btn-primary g-btn-sm">Connect</Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">A wallet admin can connect this</span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </article>
          ))}
        </section>
      )}
    </div>
  )
}
