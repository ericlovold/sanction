import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { DocsHeader } from "@/components/docs-header"
import { Markdown } from "@/components/markdown"
import { BLOG_POSTS, getPost } from "@/lib/blog"

export function generateStaticParams() {
  return BLOG_POSTS.map((p) => ({ slug: p.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const post = getPost(slug)
  if (!post) return {}
  return {
    title: `${post.title} — Sanction Blog`,
    description: post.description,
    openGraph: {
      title: post.title,
      description: post.description,
      type: "article",
      publishedTime: post.date,
    },
  }
}

function fmt(date: string) {
  return new Date(date + "T00:00:00Z").toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  })
}

export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const post = getPost(slug)
  if (!post) notFound()

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <DocsHeader />

      <main className="max-w-3xl mx-auto px-6 py-14">
        <Link href="/blog" className="text-sm text-muted-foreground hover:text-foreground">
          ← All posts
        </Link>

        <article className="mt-8">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <time className="text-muted-foreground" dateTime={post.date}>
              {fmt(post.date)}
            </time>
            {post.tags.map((t) => (
              <span key={t} className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-400/90">
                {t}
              </span>
            ))}
          </div>
          <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-foreground">{post.title}</h1>
          <div className="mt-4 text-[15px]">
            <Markdown source={post.body} />
          </div>
        </article>

        <div className="mt-12 border-t border-border pt-6">
          <p className="text-sm text-muted-foreground">
            Shipped work lands in the{" "}
            <Link href="/changelog" className="text-emerald-400 hover:text-emerald-300">
              changelog
            </Link>
            ; what&apos;s coming is on the{" "}
            <Link href="/roadmap" className="text-emerald-400 hover:text-emerald-300">
              roadmap
            </Link>
            .
          </p>
        </div>
      </main>
    </div>
  )
}
