import type { Metadata } from "next"
import Link from "next/link"
import { DocsHeader } from "@/components/docs-header"
import { LeadCapture } from "@/components/lead-capture"
import { Markdown } from "@/components/markdown"
import { CHANGELOG } from "@/lib/changelog"

export const metadata: Metadata = {
  title: "Sanction Changelog — what's new",
  description:
    "Product updates and release notes for Sanction, the authorization layer for agents that act. Subscribe for updates, and tell us what to build next.",
}

function fmt(date: string) {
  return new Date(date + "T00:00:00Z").toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  })
}

export default function Changelog() {
  return (
    <div className="min-h-screen">
      <DocsHeader />

      <main className="max-w-3xl mx-auto px-6 py-14">
        <p className="text-sm font-medium text-emerald-400">Changelog</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">What&apos;s new</h1>
        <p className="mt-3 text-lg text-zinc-400">
          Every product and version update, in the open. Want something specific?{" "}
          <Link href="/roadmap" className="text-emerald-400 hover:text-emerald-300">
            See the roadmap and vote →
          </Link>
        </p>

        {/* Subscribe */}
        <div className="mt-8 rounded-lg border border-zinc-800 bg-zinc-900/50 p-5">
          <p className="text-sm font-medium text-zinc-200">Get updates as they ship</p>
          <p className="mb-3 mt-1 text-sm text-zinc-500">No spam, unsubscribe anytime.</p>
          <LeadCapture source="changelog" />
        </div>

        {/* Entries */}
        <div className="mt-12 space-y-12">
          {CHANGELOG.map((e) => (
            <article key={e.date + e.title} className="border-t border-zinc-900 pt-8">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <time className="text-zinc-500" dateTime={e.date}>
                  {fmt(e.date)}
                </time>
                {e.version && (
                  <span className="rounded-full border border-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400">{e.version}</span>
                )}
                {e.tags?.map((t) => (
                  <span key={t} className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-400/90">
                    {t}
                  </span>
                ))}
              </div>
              <h2 className="mt-2 font-display text-xl font-semibold tracking-tight text-zinc-100">{e.title}</h2>
              <div className="mt-1 text-[15px]">
                <Markdown source={e.body} />
              </div>
            </article>
          ))}
        </div>
      </main>
    </div>
  )
}
