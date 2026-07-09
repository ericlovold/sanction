import type { Metadata } from "next"
import Link from "next/link"
import { DocsHeader } from "@/components/docs-header"
import { IdeaBoard } from "@/components/idea-board"
import { ROADMAP, type RoadmapItem } from "@/lib/roadmap"
import { listPublishedIdeas } from "@/lib/ideas"

// Votes and new submissions should show fresh; this page reads the DB on request.
export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Sanction Roadmap — what we're building, and what you want next",
  description:
    "Sanction's public roadmap: what's shipping now, next, and later — plus a community feature board where you can submit ideas and vote on what we build next.",
}

const COLS: { key: keyof typeof ROADMAP; label: string; tone: string }[] = [
  { key: "now", label: "Now", tone: "text-emerald-400" },
  { key: "next", label: "Next", tone: "text-zinc-300" },
  { key: "later", label: "Later", tone: "text-zinc-500" },
]

function Column({ label, tone, items }: { label: string; tone: string; items: RoadmapItem[] }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-5">
      <p className={`text-[11px] font-medium uppercase tracking-wide ${tone}`}>{label}</p>
      <div className="mt-4 space-y-4">
        {items.map((it) => (
          <div key={it.title}>
            <p className="text-sm font-medium text-zinc-100">{it.title}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">{it.note}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

export default async function Roadmap() {
  const ideas = await listPublishedIdeas()

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <DocsHeader />

      <main className="max-w-4xl mx-auto px-6 py-14">
        <p className="text-sm font-medium text-emerald-400">Roadmap</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">Building the authorization layer for AI agents</h1>
        <p className="mt-3 max-w-2xl text-lg text-zinc-400">
          Sanction is built in the open. Every item moves toward one goal: making autonomous agents governable,
          auditable, and safe to trust. You decide what comes next on the board below — shipped work shows up in the{" "}
          <Link href="/changelog" className="text-emerald-400 hover:text-emerald-300">
            changelog
          </Link>
          .
        </p>

        {/* Curated roadmap */}
        <section className="mt-10 grid gap-4 md:grid-cols-3">
          {COLS.map((c) => (
            <Column key={c.key} label={c.label} tone={c.tone} items={ROADMAP[c.key]} />
          ))}
        </section>

        {/* Community board */}
        <section className="mt-16">
          <h2 className="font-display text-2xl font-semibold tracking-tight">You decide what&apos;s next</h2>
          <p className="mt-2 max-w-2xl text-zinc-400">
            Submit a feature idea and upvote the ones you want most. The board is curated — we review submissions, then
            move them from <span className="text-zinc-300">under consideration</span> to{" "}
            <span className="text-emerald-400">shipped</span> as they land.
          </p>
          <div className="mt-6">
            <IdeaBoard initialIdeas={ideas} />
          </div>
        </section>
      </main>
    </div>
  )
}
