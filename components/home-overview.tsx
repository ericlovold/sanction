import Link from "next/link"
import { BrandIcon, BrandNotice } from "@/components/brand-icon"
import { fmtUsd } from "@/lib/format"
import type { HomeOverviewData } from "@/lib/homeOverview"
import { sourceNames } from "@/lib/usageObservation"

function deliveryDate(value: Date | null) {
  return value ? value.toISOString().replace("T", " ").slice(0, 16) + " UTC" : "None received"
}

export function HomeOverview({ data }: { data: HomeOverviewData }) {
  return <>
    <section className="home-section" aria-labelledby="home-providers" data-tour="home-overview">
      <div className="home-section-head">
        <h2 id="home-providers" className="home-h2">Model providers</h2>
        <Link href="/dashboard/providers" className="home-link">Manage providers</Link>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">Current wallet only · recorded model spend this month (UTC).</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {data.providers.map(provider => <article key={provider.id} className="g-glass rounded-xl border border-border p-4">
          <h3 className="flex items-center gap-2 text-sm font-medium"><BrandIcon brand={provider.id} size={24} />{provider.name}</h3>
          <p className="mt-3 text-xs text-muted-foreground">{provider.keyStatus}</p>
          <p className="mt-4 font-mono text-lg">{data.spendUnavailable ? "Unavailable" : provider.spend === null ? "No records" : fmtUsd(provider.spend)}</p>
          <p className="mt-1 text-xs text-muted-foreground">Recorded model spend</p>
          <Link href="/dashboard/providers" className="home-link mt-4 inline-block">{provider.keyStatus === "No stored key" ? "Set up provider" : "Manage key"}</Link>
        </article>)}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">A stored key does not confirm provider health. Records include gateway usage and submitted token logs; no records does not mean zero usage.</p>
      {data.otherSpend !== null && <p className="mt-2 text-xs text-muted-foreground">Other or unattributed models: {fmtUsd(data.otherSpend)} recorded this month.</p>}
    </section>

    <section className="home-section" aria-labelledby="home-tools">
      <div className="home-section-head">
        <h2 id="home-tools" className="home-h2">Developer tools</h2>
        <Link href="/dashboard/usage" className="home-link">View usage</Link>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">Current wallet only · client-reported activity over the last 7 days.</p>
      <div className="grid gap-3 md:grid-cols-2">
        {data.tools.map(tool => <article key={tool.source} className="g-glass rounded-xl border border-border p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-base font-medium"><BrandIcon brand={tool.source} size={26} />{sourceNames[tool.source]}</h3>
            <span className="rounded border border-border px-2 py-1 text-xs text-muted-foreground">Observation only</span>
          </div>
          <p className="mt-4 text-sm font-medium">{tool.status}</p>
          <p className="mt-1 text-xs text-muted-foreground">Last delivery: {tool.status === "Reporting unavailable" ? "Unavailable" : deliveryDate(tool.receivedAt)}</p>
          <dl className="mt-5 grid grid-cols-3 gap-3 text-sm">
            <div><dt className="text-xs text-muted-foreground">Sessions</dt><dd className="mt-1 font-mono">{tool.sessions ?? "Unavailable"}{tool.sessions !== null && tool.truncated ? "+" : ""}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Tokens</dt><dd className="mt-1 font-mono">{tool.tokens === null ? "Unavailable" : tool.tokens.toLocaleString("en-US")}{tool.tokens !== null && tool.tokensPartial && <span className="block text-xs">Partial</span>}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Reported estimate</dt><dd className="mt-1 font-mono">{tool.estimatedCost === null ? "Unavailable" : `$${tool.estimatedCost.toFixed(4)}`}{tool.estimatedCost !== null && tool.estimatePartial && <span className="block text-xs">Partial</span>}</dd></div>
          </dl>
          {tool.truncated && <p className="mt-3 text-xs text-muted-foreground">Partial window: only the most recent 1,000 events are included.</p>}
          <Link className="home-link mt-5 inline-block" href={`/dashboard/connect?source=${tool.source}`}>{tool.receivedAt ? "Review setup" : "Set up reporting"}</Link>
        </article>)}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Idle, offline, and unconfigured clients can all have no recent delivery. Estimates are not invoices or subscription balances, and are not added to recorded model spend.</p>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
        <Link href="/dashboard/usage/cursor" className="home-link">Cursor billing export</Link>
        <Link href="/dashboard/connect" className="home-link">Connect a tool</Link>
        <Link href="/dashboard/agents" className="home-link">Manage agents</Link>
        <Link href="/dashboard/spend" className="home-link">Spend and budgets</Link>
      </div>
      <div className="mt-4"><BrandNotice /></div>
    </section>
  </>
}
