import type { Metadata } from "next"
import Link from "next/link"
import { CreateWallet } from "@/components/create-wallet"
import { McpInstall } from "@/components/mcp-install"
import { SocialSignIn } from "@/components/social-signin"
import "../brand.css"
import { brandFontVars } from "../brand-fonts"

export const metadata: Metadata = {
  title: "Sanction — Create your wallet",
  description: "Create a Sanction wallet and agent key in seconds. Free, no card.",
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
        <h1 className="text-3xl font-semibold tracking-tight">Create your wallet</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
          A wallet holds your policy; agents get scoped keys. Sign up in one click —
          then your agent asks Sanction before it spends.
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

        <h2 className="text-lg font-semibold tracking-tight">Add Sanction to your stack</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          One click puts the Sanction tools in front of your agent — it asks before it spends, and every decision is
          logged. Paste the agent key and wallet id from the step above.
        </p>
        <div className="mt-5">
          <McpInstall />
        </div>
      </main>
    </div>
  )
}
