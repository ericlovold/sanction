import type { Metadata } from "next"
import Link from "next/link"
import { DocsHeader } from "@/components/docs-header"
import { allPosts } from "@/lib/blog"

export const metadata: Metadata = {
  title: "Blog — Sanction",
  description:
    "Writing from Sanction, the wallet an AI agent carries: agent payments, authorization, and the governance layer between an agent and everything it can do.",
}

function fmt(date: string) {
  return new Date(date + "T00:00:00Z").toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  })
}

export default function Blog() {
  const posts = allPosts()

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <DocsHeader />

      <main className="max-w-3xl mx-auto px-6 py-14">
        <p className="text-sm font-medium text-emerald-400">Blog</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">Writing from Sanction</h1>
        <p className="mt-3 text-lg text-muted-foreground">
          Longer-form thinking behind the ships. For the release-by-release record, see the{" "}
          <Link href="/changelog" className="text-emerald-400 hover:text-emerald-300">
            changelog →
          </Link>
        </p>

        <div className="mt-12 space-y-12">
          {posts.map((p) => (
            <article key={p.slug} className="border-t border-border pt-8">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <time className="text-muted-foreground" dateTime={p.date}>
                  {fmt(p.date)}
                </time>
                {p.tags.map((t) => (
                  <span key={t} className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-400/90">
                    {t}
                  </span>
                ))}
              </div>
              <h2 className="mt-2 font-display text-xl font-semibold tracking-tight text-foreground">
                <Link href={`/blog/${p.slug}`} className="hover:text-emerald-400">
                  {p.title}
                </Link>
              </h2>
              <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{p.description}</p>
              <p className="mt-3">
                <Link href={`/blog/${p.slug}`} className="text-sm text-emerald-400 hover:text-emerald-300">
                  Read the post →
                </Link>
              </p>
            </article>
          ))}
        </div>
      </main>
    </div>
  )
}
