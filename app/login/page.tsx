import type { Metadata } from "next"
import Link from "next/link"
import { LoginForm } from "@/components/login-form"
import { MagicLinkForm } from "@/components/magic-link-form"
import { SocialSignIn } from "@/components/social-signin"
import "../brand.css"
import { brandFontVars } from "../brand-fonts"

export const metadata: Metadata = {
  title: "Sanction — Sign in",
  description: "Sign in to your Sanction console with Google, GitHub, or your management key.",
}

function Divider({ label }: { label: string }) {
  return (
    <div className="my-8 flex items-center gap-3 text-[11px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
      <span className="h-px flex-1" style={{ background: "var(--paper-3)" }} />
      {label}
      <span className="h-px flex-1" style={{ background: "var(--paper-3)" }} />
    </div>
  )
}

export const dynamic = "force-dynamic"

export default function LoginPage() {
  return (
    <div className={`sanction ${brandFontVars}`} style={{ minHeight: "100vh", background: "var(--surface-page)", color: "var(--text-body)" }}>
      <header className="border-b" style={{ borderColor: "var(--paper-3)" }}>
        <nav className="mx-auto flex h-14 max-w-3xl items-center justify-between px-6">
          <Link href="/" className="font-semibold tracking-tight">Sanction</Link>
          <Link href="/start" className="sanction-link text-sm">Create a wallet →</Link>
        </nav>
      </header>

      <main className="mx-auto max-w-md px-6 py-14">
        <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>Welcome back. Sign in to your Sanction console.</p>

        <div className="mt-8">
          <SocialSignIn apple={!!process.env.APPLE_CLIENT_ID} />
        </div>

        <Divider label="or with email" />
        <MagicLinkForm />

        <details className="mt-8 group">
          <summary className="sanction-link cursor-pointer list-none text-xs">
            Have a management key (<code className="font-mono">sk_…</code>)? Sign in with it →
          </summary>
          <div className="mt-4">
            <LoginForm />
          </div>
        </details>

        <p className="mt-8 text-xs" style={{ color: "var(--text-muted)" }}>
          No wallet yet? <Link href="/start" style={{ color: "var(--status-approved)" }}>Create one free →</Link>
        </p>
      </main>
    </div>
  )
}
