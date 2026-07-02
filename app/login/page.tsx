import type { Metadata } from "next"
import Link from "next/link"
import { LoginForm } from "@/components/login-form"
import { MagicLinkForm } from "@/components/magic-link-form"
import { SocialSignIn } from "@/components/social-signin"

export const metadata: Metadata = {
  title: "Sanction — Sign in",
  description: "Sign in to your Sanction console with Google, GitHub, or your management key.",
}

function Divider({ label }: { label: string }) {
  return (
    <div className="my-8 flex items-center gap-3 text-[11px] uppercase tracking-wide text-zinc-600">
      <span className="h-px flex-1 bg-zinc-900" />
      {label}
      <span className="h-px flex-1 bg-zinc-900" />
    </div>
  )
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
        <p className="mt-2 text-sm text-zinc-400">Welcome back. Sign in to your Sanction console.</p>

        <div className="mt-8">
          <SocialSignIn />
        </div>

        <Divider label="or with email" />
        <MagicLinkForm />

        <details className="mt-8 group">
          <summary className="cursor-pointer list-none text-xs text-zinc-500 transition-colors hover:text-zinc-300">
            Have a management key (<code className="font-mono">sk_…</code>)? Sign in with it →
          </summary>
          <div className="mt-4">
            <LoginForm />
          </div>
        </details>

        <p className="mt-8 text-xs text-zinc-600">
          No wallet yet? <Link href="/start" className="text-emerald-400 hover:text-emerald-300">Create one free →</Link>
        </p>
      </main>
    </div>
  )
}
