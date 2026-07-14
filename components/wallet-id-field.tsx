"use client"

import { useState } from "react"

// The wallet id is non-secret (authorization rests on keys, never on knowing the
// id) but it's needed for API calls, org adoption, and support — so surface it
// here, copyable. Previously it was shown nowhere in the console.
export function WalletIdField({ walletId }: { walletId: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">Wallet ID</span>
      <code className="rounded border border-border bg-card px-2 py-1 font-mono text-xs text-foreground">{walletId}</code>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(walletId)
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        }}
        className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
      >
        {copied ? "Copied ✓" : "Copy"}
      </button>
    </div>
  )
}
