import Link from "next/link"

// Shared full-screen prompt shown by any dashboard page when there's no wallet in
// context (logged out, no demo wallet). Rendered without the console shell — the
// layout returns children bare when getViewWallet() is null.
export function NoWallet() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="space-y-3 text-center">
        <p className="text-sm text-muted-foreground">No wallet to show.</p>
        <div className="flex items-center justify-center gap-3 text-sm">
          <Link href="/login" className="text-emerald-400 hover:text-primary">Log in</Link>
          <Link href="/start" className="text-muted-foreground hover:text-foreground">Create a wallet</Link>
        </div>
      </div>
    </div>
  )
}
