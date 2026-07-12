import Link from "next/link"

// Shared header for the public docs pages.
export function DocsHeader() {
  return (
    <header className="sticky top-0 z-10 border-b border-zinc-900 bg-zinc-950/80 backdrop-blur">
      <nav className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <Link href="/" className="font-display font-semibold tracking-tight">Sanction</Link>
        <div className="flex items-center gap-6 text-sm text-zinc-400">
          <Link href="/docs" className="hover:text-zinc-100 transition-colors">Docs</Link>
          <Link href="/architecture" className="hover:text-zinc-100 transition-colors">Architecture</Link>
          <Link href="/compliance" className="hidden sm:inline hover:text-zinc-100 transition-colors">EU AI Act</Link>
          <Link href="/compatibility" className="hidden sm:inline hover:text-zinc-100 transition-colors">Compatibility</Link>
          <Link href="/roadmap" className="hidden sm:inline hover:text-zinc-100 transition-colors">Roadmap</Link>
          <Link href="/changelog" className="hidden sm:inline hover:text-zinc-100 transition-colors">Changelog</Link>
          <a href="/api/openapi.json" className="hidden sm:inline hover:text-zinc-100 transition-colors">API</a>
          <Link href="/login" className="hover:text-zinc-100 transition-colors">Sign in</Link>
          <Link href="/start" className="rounded-md bg-zinc-100 text-zinc-950 px-3 py-1.5 text-sm font-medium hover:bg-white transition-colors">
            Start free
          </Link>
        </div>
      </nav>
    </header>
  )
}
