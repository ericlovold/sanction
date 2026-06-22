import type { Metadata } from "next"
import Link from "next/link"
import { LoginForm } from "@/components/login-form"
import { MagicLinkForm } from "@/components/magic-link-form"

export const metadata: Metadata = {
  title: "Sanction — Sign in",
  description: "Sign in to your Sanction wallet with your management key.",
}

export const dynamic = "force-dynamic"

export default function LoginPage() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-zinc-900">
        <nav className="mx-auto flex h-14 max-w-3xl items-center justify-between px-6">
          <Link href="/" className="font-display font-semibold tracking-tight">Sanction</Link>
          <Link href="/start" className="text-sm text-zinc-400 hover:text-zinc-100">Create a wallet →</Link>
        </nav>
      </header>

      <main className="mx-auto max-w-md px-6 py-14">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Paste the management key (<code className="font-mono text-xs">sk_…</code>) you saved when you created your
          wallet. It&apos;s your login — keep it somewhere safe.
        </p>
        <div className="mt-8">
          <LoginForm />
        </div>

        <div className="my-8 flex items-center gap-3 text-[11px] uppercase tracking-wide text-zinc-600">
          <span className="h-px flex-1 bg-zinc-900" />
          lost your key?
          <span className="h-px flex-1 bg-zinc-900" />
        </div>

        <MagicLinkForm />

        <p className="mt-6 text-xs text-zinc-600">
          No wallet yet? <Link href="/start" className="text-emerald-400 hover:text-emerald-300">Create one free →</Link>
        </p>
      </main>
    </div>
  )
}
