import { safeNext } from "@/lib/returnPath"
import type { Metadata } from "next"
import Link from "next/link"
import { VerifyMagicLink } from "@/components/verify-magic-link"

export const metadata: Metadata = {
  title: "Sanction — Sign in",
  description: "Finish signing in to your Sanction wallet.",
}

export const dynamic = "force-dynamic"

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ token?: string; next?: string }> }) {
  const { token, next: rawNext } = await searchParams
  const next = safeNext(rawNext)
  const loginUrl = `/login?next=${encodeURIComponent(next)}`

  return (
    <div className="min-h-screen">
      <header className="border-b border-zinc-900">
        <nav className="mx-auto flex h-14 max-w-3xl items-center justify-between px-6">
          <Link href="/" className="font-display font-semibold tracking-tight">Sanction</Link>
          <Link href={loginUrl} className="text-sm text-zinc-400 hover:text-zinc-100">Sign in another way →</Link>
        </nav>
      </header>

      <main className="mx-auto max-w-md px-6 py-14">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Finish signing in</h1>
        <div className="mt-8">
          {token ? (
            <VerifyMagicLink token={token} next={next} />
          ) : (
            <p className="text-sm text-zinc-400">
              This link is missing its token. Request a new one from the{" "}
              <Link href={loginUrl} className="text-emerald-400 hover:text-emerald-300">sign-in page</Link>.
            </p>
          )}
        </div>
      </main>
    </div>
  )
}
