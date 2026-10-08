import type { Metadata } from "next"
import Link from "next/link"
import { CreateWallet } from "@/components/create-wallet"
import { McpInstall } from "@/components/mcp-install"
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

      <main className="mx-auto max-w-md px-6 py-14">
        <p className="sn-mono mb-4" style={{ color: "var(--ochre-7)" }}>A human decision, before the action</p>
        <h1 className="text-3xl font-semibold tracking-tight">Start with one approval.</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
          Create an account, connect your AI tool, and ask it to bring a proposed action
          to you for review. Free for individuals. No card.
        </p>

        <p className="mt-4 text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
          Your account includes a wallet for your rules and decision history.
          You can request a one-off approval without writing a policy first.
        </p>

        <div className="mt-8">
          <SocialSignIn apple={!!process.env.APPLE_CLIENT_ID} />
        </div>

        <div className="my-8 flex items-center gap-3 text-[11px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          <span className="h-px flex-1" style={{ background: "var(--paper-3)" }} />
          or with email
          <span className="h-px flex-1" style={{ background: "var(--paper-3)" }} />
        </div>

        <CreateWallet />

        <div className="my-10 flex items-center gap-3 text-[11px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          <span className="h-px flex-1" style={{ background: "var(--paper-3)" }} />
          then connect your agent
          <span className="h-px flex-1" style={{ background: "var(--paper-3)" }} />
        </div>

        <div className="mb-8 rounded-lg border-l-2 p-5" style={{ borderColor: "var(--ochre-6)", background: "var(--ochre-tint)" }}>
          <h2 className="text-lg font-semibold tracking-tight">Try a harmless approval request</h2>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            The connection guide walks you through setup and a test that executes nothing.
          </p>
          <Link href="/docs/connect" className="sanction-link mt-3 inline-block text-sm">Connect your AI tool →</Link>
        </div>

        <h2 className="text-lg font-semibold tracking-tight">Building with an agent key?</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          Use the developer setup below with your agent key and wallet ID. Your agent must
          ask Sanction and honor its answer; connecting does not intercept its other tools.
        </p>
        <div className="mt-5">
          <McpInstall />
        </div>
      </main>
    </div>
  )
}
