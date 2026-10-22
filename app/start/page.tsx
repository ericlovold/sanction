import type { Metadata } from "next"
import Link from "next/link"
import { CreateWallet } from "@/components/create-wallet"
import { ApprovalPreview } from "@/components/approval-preview"
import { SocialSignIn } from "@/components/social-signin"
import "../brand.css"
import { brandFontVars } from "../brand-fonts"

export const metadata: Metadata = {
  title: "Sanction — Start with one approval",
  description: "Create your Sanction account, connect your AI tool, and request a human approval. Free for individuals, no card.",
}

export const dynamic = "force-dynamic"

export default function StartPage() {
  return (
    <div className={`sanction ${brandFontVars}`} style={{ minHeight: "100vh", background: "var(--surface-page)", color: "var(--text-body)" }}>
      <header className="border-b" style={{ borderColor: "var(--paper-3)" }}>
        <nav className="mx-auto flex h-14 max-w-3xl items-center justify-between px-6">
          <Link href="/" className="font-semibold tracking-tight">Sanction</Link>
          <Link href="/dashboard/spend" className="sanction-link text-sm">See it live →</Link>
        </nav>
      </header>

      <main className="mx-auto max-w-xl px-6 py-10">
        <p className="sn-mono mb-4" style={{ color: "var(--ochre-7)" }}>A human decision, before the action</p>
        <h1 className="text-3xl font-semibold tracking-tight">Start with one approval.</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
          See what your agent wants to do. Approve it or stop it.
          Try the preview, then connect your own tool. Free for individuals. No card.
        </p>

        <CreateWallet intro={<>
          <a href="#create-account" className="sanction-link mt-3 inline-block text-sm">Ready to connect? Create your workspace →</a>
          <div className="mt-7"><ApprovalPreview /></div>

          <div id="create-account" className="mt-10 scroll-mt-6" aria-labelledby="create-heading">
          <h2 id="create-heading" className="text-xl font-semibold">Make it yours.</h2>
          <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
            Create your workspace, connect an AI tool, and review your first request.
          </p>
          <div className="mt-8">
            <SocialSignIn apple={!!process.env.APPLE_CLIENT_ID} />
          </div>

          <div className="my-8 flex items-center gap-3 text-[11px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            <span className="h-px flex-1" style={{ background: "var(--paper-3)" }} />
            or with email
            <span className="h-px flex-1" style={{ background: "var(--paper-3)" }} />
          </div>

          </div>
        </>} />

        <p className="mt-6 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          Already have an account? <Link href="/login" className="sanction-link">Sign in</Link>
        </p>
      </main>
    </div>
  )
}
