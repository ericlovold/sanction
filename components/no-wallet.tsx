import Link from "next/link"

// Shared full-screen prompt shown by any dashboard page when there's no wallet in
// context (logged out, no demo wallet). Rendered without the console shell.
export function NoWallet() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="space-y-3 text-center">
        <p className="text-sm text-zinc-400">No wallet to show.</p>
        <div className="flex items-center justify-center gap-3 text-sm">
          <Link href="/login" className="text-emerald-400 hover:text-emerald-300">Log in</Link>
          <Link href="/start" className="text-zinc-400 hover:text-zinc-200">Create a wallet</Link>
        </div>
      </div>
    </div>
  )
}
