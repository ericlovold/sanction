"use client"

import { switchWalletAction } from "@/app/dashboard/actions"

// WALLET-MEMBERS part 2: pick which reachable wallet to act as. Rendered in
// the sidebar header only when the session can reach more than one wallet
// (owned + active memberships) — a single-wallet session keeps the plain
// name line. Selection submits immediately; the server action re-validates
// against listSessionWallets before setting the cookie.
export function WalletSwitcher({
  wallets,
  activeId,
}: {
  wallets: Array<{ id: string; name: string; role: string }>
  activeId: string
}) {
  return (
    <form action={switchWalletAction}>
      <select
        name="wallet_id"
        defaultValue={activeId}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        aria-label="Switch wallet"
        className="mt-2 w-full truncate rounded border border-sidebar-border bg-transparent px-1 py-0.5 font-mono text-[11px] text-sidebar-foreground/70 outline-none hover:text-sidebar-foreground"
      >
        {wallets.map((w) => (
          <option key={w.id} value={w.id} className="bg-sidebar text-sidebar-foreground">
            {w.name} · {w.role}
          </option>
        ))}
      </select>
    </form>
  )
}
