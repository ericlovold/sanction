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
    <div className="my-8 flex items-center gap-3 text-[11px] uppercase tracking-wide text-muted-foreground">
      <span className="h-px flex-1 bg-card" />
      {label}
      <span className="h-px flex-1 bg-card" />
    </div>
  )
}

export const dynamic = "force-dynamic"

export default function LoginPage() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-border">
        <nav className="mx-auto flex h-14 max-w-3xl items-center justify-between px-6">
          <Link href="/" className="font-display font-semibold tracking-tight">Sanction</Link>
          <Link href="/start" className="text-sm text-muted-foreground hover:text-foreground">Create a wallet →</Link>
        </nav>
      </header>

      <main className="mx-auto max-w-md px-6 py-14">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm text-muted-foreground">Welcome back. Sign in to your Sanction console.</p>

        <div className="mt-8">
          <SocialSignIn apple={!!process.env.APPLE_CLIENT_ID} />
        </div>

        <Divider label="or with email" />
        <MagicLinkForm />

        <details className="mt-8 group">
          <summary className="cursor-pointer list-none text-xs text-foreground0 transition-colors hover:text-foreground">
            Have a management key (<code className="font-mono">sk_…</code>)? Sign in with it →
          </summary>
          <div className="mt-4">
            <LoginForm />
          </div>
        </details>

        <p className="mt-8 text-xs text-muted-foreground">
          No wallet yet? <Link href="/start" className="text-signal hover:text-signal">Create one free →</Link>
        </p>
      </main>
    </div>
  )
}
