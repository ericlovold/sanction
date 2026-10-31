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
          <Link href="/login" className="sanction-link text-sm">Sign in →</Link>
        </nav>
      </header>

      <main className="mx-auto max-w-xl px-6 py-10">
        <p className="sn-mono mb-4" style={{ color: "var(--ochre-7)" }}>A human decision, before the action</p>
        <h1 className="text-3xl font-semibold tracking-tight">Start with one approval.</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
          See what your agent wants to do. Approve it or stop it.
          Try the preview, then connect your own tool. Free for individuals. No card.
        </p>

        <a href="#create-account" className="sanction-link mt-3 inline-block text-sm">Ready to connect? Skip to setup →</a>
        <div className="mt-7"><ApprovalPreview /></div>

        <section id="create-account" className="mt-10 scroll-mt-6" aria-labelledby="create-heading">
          <h2 id="create-heading" className="text-xl font-semibold">Connect your own AI tool.</h2>
          <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
            Sign in to create or open your workspace. Then choose your AI tool,
            send a test request, and review it in your approval inbox.
          </p>
          <ol className="mt-5 space-y-2 text-sm" aria-label="Setup steps">
            <li>1. Sign in with a verified account.</li>
            <li>2. Connect your AI tool. Per-host steps: <Link href="/install" className="sanction-link">Install</Link>.</li>
            <li>3. Approve or deny a test request. Nothing executes.</li>
          </ol>
          <div className="mt-6">
            <SocialSignIn apple={!!process.env.APPLE_CLIENT_ID} />
          </div>
          <p className="mt-3 text-xs" style={{ color: "var(--text-secondary)" }}>
            Recommended for AI-host connections. You do not need to copy API keys.
          </p>
          <p className="mt-4 text-sm" style={{ color: "var(--text-secondary)" }}>
            Already have an account? <Link href="/login" className="sanction-link">See all sign-in options →</Link>
          </p>
          <p className="mt-5 text-xs" style={{ color: "var(--text-muted)" }}>
            Your connected agent must ask Sanction and honor the decision.
            Connecting does not intercept its other tools. Slack review is an optional setup step.
          </p>
        </section>

        <details className="mt-8 rounded-lg border p-5" style={{ borderColor: "var(--paper-3)" }}>
          <summary className="sanction-link cursor-pointer text-sm font-medium">Developer setup: create a workspace with access keys</summary>
          <p className="my-4 text-sm" style={{ color: "var(--text-secondary)" }}>
            For API-key integrations. This creates access keys to save securely; it does not
            verify your email or create an AI-host sign-in. For an OAuth connection,
            use the verified sign-in options above.
          </p>
          <CreateWallet />
        </details>

      </main>
    </div>
  )
}
