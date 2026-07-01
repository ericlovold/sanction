import type { Metadata } from "next"
import Link from "next/link"
import { CreateWallet } from "@/components/create-wallet"
import { SocialSignIn } from "@/components/social-signin"

export const metadata: Metadata = {
  title: "Sanction — Create your wallet",
  description: "Create a Sanction wallet and agent key in seconds. Free, no card.",
}

export const dynamic = "force-dynamic"

export default function StartPage() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-zinc-900">
        <nav className="mx-auto flex h-14 max-w-3xl items-center justify-between px-6">
          <Link href="/" className="font-display font-semibold tracking-tight">Sanction</Link>
          <Link href="/dashboard/spend" className="text-sm text-zinc-400 hover:text-zinc-100">See it live →</Link>
        </nav>
      </header>

      <main className="mx-auto max-w-md px-6 py-14">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Create your wallet</h1>
        <p className="mt-2 text-sm text-zinc-400">
          A wallet holds your policy; agents get scoped keys. Sign up in one click —
          then your agent asks Sanction before it spends.
        </p>

        <div className="mt-8">
          <SocialSignIn />
        </div>

        <div className="my-8 flex items-center gap-3 text-[11px] uppercase tracking-wide text-zinc-600">
          <span className="h-px flex-1 bg-zinc-900" />
          or with email
          <span className="h-px flex-1 bg-zinc-900" />
        </div>

        <CreateWallet />
      </main>
    </div>
  )
}
