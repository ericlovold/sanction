import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { DOCS, readDoc } from "@/lib/docs"
import { Markdown } from "@/components/markdown"
import { DocsHeader } from "@/components/docs-header"

export function generateStaticParams() {
  return Object.keys(DOCS).map((slug) => ({ slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const meta = DOCS[slug]
  if (!meta) return {}
  return { title: `Sanction Docs — ${meta.title}`, description: meta.description }
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const doc = readDoc(slug)
  if (!doc) notFound()

  return (
    <div className="min-h-screen">
      <DocsHeader />
      <main className="max-w-3xl mx-auto px-6 py-12">
        <Link href="/docs" className="text-sm text-zinc-500 hover:text-zinc-300">← All docs</Link>
        <article className="mt-6">
          <Markdown source={doc.md} />
        </article>
        <div className="mt-12 border-t border-zinc-900 pt-6">
          <Link href="/start" className="inline-block rounded-md bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-400">
            Start free →
          </Link>
        </div>
      </main>
    </div>
  )
}
