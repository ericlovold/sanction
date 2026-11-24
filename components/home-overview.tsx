import Link from "next/link"
import { BrandIcon, BrandNotice } from "@/components/brand-icon"
import { fmtUsd } from "@/lib/format"
import type { HomeOverviewData } from "@/lib/homeOverview"
import { sourceNames } from "@/lib/usageObservation"

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
        </article>)}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">A stored key does not confirm provider health. Records include gateway usage and submitted token logs; no records does not mean zero usage.</p>
      {data.otherSpend !== null && <p className="mt-2 text-xs text-muted-foreground">Other or unattributed models: {fmtUsd(data.otherSpend)} recorded this month.</p>}
    </section>

    <section className="home-section" aria-labelledby="home-tools">
      <div className="home-section-head">
        <h2 id="home-tools" className="home-h2">Developer tools</h2>
        <Link href="/dashboard/usage" className="home-link">View usage details</Link>
      </div>
      <p className="mb-3 text-sm text-muted-foreground">Latest client reporting for this wallet. Recent deliveries arrived in the last 15 minutes.</p>
      <ul className="g-glass divide-y divide-border rounded-xl border border-border">
        {data.tools.map(tool => <li key={tool.source} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="flex items-center gap-2 text-sm font-medium"><BrandIcon brand={tool.source} size={22} />{sourceNames[tool.source]}</span>
            <span className="text-sm text-muted-foreground">{tool.status}</span>
          </div>
          <Link href={`/dashboard/connect?source=${tool.source}`} className="home-link">
            Setup<span className="sr-only"> for {sourceNames[tool.source]}</span>
          </Link>
        </li>)}
      </ul>
      <div className="mt-4"><BrandNotice /></div>
    </section>
  </>
}
