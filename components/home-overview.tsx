import Link from "next/link"
import { BrandIcon, BrandNotice } from "@/components/brand-icon"
import { fmtUsd } from "@/lib/format"
import type { HomeOverviewData } from "@/lib/homeOverview"
import type { ConnectedTool, MethodState, SpendSource } from "@/lib/connectedTools"

export const PICK_TOOLS_HREF = "/dashboard/tools"

const HEADLINE: Record<SpendSource, string> = {
  billed: "Billed by the provider this month",
  recorded: "Estimated from usage recorded in Sanction this month",
}

const DOT: Record<MethodState, string> = {
  ok: "bg-emerald-500",
  waiting: "bg-zinc-400",
  attention: "bg-amber-500",
}

function ToolCard({ tool }: { tool: ConnectedTool }) {
  return (
    <article className="g-glass rounded-xl border border-border p-4">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <BrandIcon brand={tool.brand} label={tool.name} size={24} />
        {tool.name}
      </h3>
      {tool.headline ? (
        <>
          <p className="mt-4 font-mono text-lg">{fmtUsd(tool.headline.usd)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{HEADLINE[tool.headline.source]}</p>
        </>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">No spend figure yet</p>
      )}
      {tool.alsoRecordedUsd !== null && (
        <p className="mt-1 text-xs text-muted-foreground">
          Also recorded in Sanction: about {fmtUsd(tool.alsoRecordedUsd)}, which may already be in the billed total.
        </p>
      )}
      <ul className="mt-3 space-y-1.5 text-xs">
        {tool.methods.map((m) => (
          <li key={m.label} className="flex items-start gap-2">
            <span aria-hidden className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${DOT[m.state]}`} />
            <span>
              {m.href ? <Link href={m.href} className="underline underline-offset-2">{m.label}</Link> : m.label}
              <span className="block text-muted-foreground">{m.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </article>
  )
}

export function HomeOverview({ data, canConnect = false }: { data: HomeOverviewData; canConnect?: boolean }) {
  const { view } = data
  return (
    <section className="home-section" aria-labelledby="home-tools" data-tour="home-overview">
      <div className="home-section-head">
        <h2 id="home-tools" className="home-h2">Your AI tools</h2>
        {view.kind === "tools" && view.addable.length > 0 && (
          <Link href={PICK_TOOLS_HREF} className="home-link">Add a tool</Link>
        )}
      </div>

      {view.kind === "unavailable" && (
        <p className="text-sm text-muted-foreground">
          Connections could not be read just now. This does not mean nothing is connected.
        </p>
      )}

      {view.kind === "empty" && (
        <div className="g-glass rounded-xl border border-border p-5">
          <p className="text-sm font-medium">No AI tools connected yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Pick the tools you use and connect them. Only what you connect shows here.
          </p>
          {canConnect ? (
            <Link href={PICK_TOOLS_HREF} className="g-btn g-btn-primary mt-4 inline-flex">Pick your tools</Link>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">A wallet admin can connect your tools.</p>
          )}
        </div>
      )}

      {view.kind === "tools" && (
        <>
          <p className="mb-4 text-sm text-muted-foreground">Current wallet only · this month (UTC).</p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {view.tools.map((tool) => <ToolCard key={tool.id} tool={tool} />)}
          </div>
          {view.partial && (
            <p className="mt-3 text-xs text-muted-foreground">Some connections could not be read just now, so a tool may be missing.</p>
          )}
        </>
      )}

      {data.otherSpend !== null && (
        <p className="mt-2 text-xs text-muted-foreground">Other or unattributed models: {fmtUsd(data.otherSpend)} recorded this month.</p>
      )}
      {view.kind === "tools" && <div className="mt-4"><BrandNotice /></div>}
    </section>
  )
}
