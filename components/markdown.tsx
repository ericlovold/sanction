"use client"

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { Components } from "react-markdown"

// On-site cross-links: rewrite the repo's relative .md links to /docs routes.
const ROUTES: Record<string, string> = {
  "INTEGRATION.md": "/docs/multi-tenant",
  "VERCEL-AI-SDK.md": "/docs/ai-sdk",
  "vercel-ai-sdk.md": "/docs/ai-sdk",
  "QUICKSTART.md": "/docs/quickstart",
  "quickstart.md": "/docs/quickstart",
  "LANGCHAIN.md": "/docs/langchain",
  "langchain.md": "/docs/langchain",
  "CREWAI.md": "/docs/crewai",
  "crewai.md": "/docs/crewai",
}

function rewriteHref(href?: string): string | undefined {
  if (!href) return href
  if (/^https?:\/\//.test(href) || href.startsWith("#") || href.startsWith("/")) return href
  const base = href.split("/").pop() ?? href
  if (ROUTES[base]) return ROUTES[base]
  if (base.endsWith(".md")) return `https://github.com/ericlovold/sanction/blob/main/docs/${base}`
  return href
}

// Colors speak the workpaper token vocabulary (globals.css :root — ink on
// light canvas, pine links). Code blocks stay deliberately dark: the one
// deep slab on the workpaper, matching the pine-rail aesthetic.
const components: Components = {
  h1: ({ children }) => <h1 className="mt-2 mb-4 font-display text-3xl font-semibold tracking-tight text-foreground">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-10 mb-3 border-t border-border pt-8 font-display text-2xl font-semibold tracking-tight text-foreground">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-6 mb-2 font-display text-lg font-semibold tracking-tight text-foreground">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-4 mb-2 font-semibold text-foreground">{children}</h4>,
  p: ({ children }) => <p className="my-4 leading-relaxed text-muted-foreground">{children}</p>,
  a: ({ href, children }) => (
    <a href={rewriteHref(href)} className="text-primary underline-offset-2 hover:underline">{children}</a>
  ),
  ul: ({ children }) => <ul className="my-4 list-disc space-y-1.5 pl-6 text-muted-foreground">{children}</ul>,
  ol: ({ children }) => <ol className="my-4 list-decimal space-y-1.5 pl-6 text-muted-foreground">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-l-2 border-primary/40 bg-primary/5 py-1 pl-4 text-foreground/80">{children}</blockquote>
  ),
  hr: () => <hr className="my-8 border-border" />,
  code: ({ className, children }) => {
    const text = String(children)
    const isBlock = /\n/.test(text) || (className?.includes("language-") ?? false)
    if (isBlock) return <code className="font-mono">{children}</code>
    return <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-primary">{children}</code>
  },
  pre: ({ children }) => (
    <pre className="my-4 overflow-x-auto rounded-md border border-zinc-800 bg-zinc-950 p-4 text-[12.5px] leading-relaxed text-zinc-300">{children}</pre>
  ),
  table: ({ children }) => (
    <div className="my-5 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="border-b border-border text-left text-foreground">{children}</thead>,
  th: ({ children }) => <th className="px-3 py-2 font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-b border-border px-3 py-2 align-top text-muted-foreground">{children}</td>,
}

export function Markdown({ source }: { source: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {source}
    </ReactMarkdown>
  )
}
