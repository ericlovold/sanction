import { getViewWallet } from "@/lib/session"
import { db } from "@/lib/db"
import { AccountControl } from "@/components/account-control"
import { DashboardSidebar } from "@/components/dashboard-sidebar"
import { SwRegister } from "@/components/sw-register"

export const dynamic = "force-dynamic"

// Console shell. Wraps every /dashboard/* page in a persistent sidebar so the
// dashboard reads as one console instead of standalone pages. When there's no
// wallet in context we render the page bare — the page shows its own full-screen
// "log in / create a wallet" prompt (<NoWallet />) without the chrome.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const view = await getViewWallet()
  if (!view) return <>{children}</>

  // Badge needs a number, not rows. The full read (and expiry settling) runs
  // on the Approvals page itself, where timeouts are actually visible.
  const [pendingCount, childWallets] = await Promise.all([
    db.pendingApproval.count({ where: { walletId: view.id, status: "pending" } }),
    db.wallet.count({ where: { parentId: view.id } }),
  ])

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <DashboardSidebar
        view={{ name: view.name, isSession: view.isSession }}
        pendingCount={pendingCount}
        hasPools={childWallets > 0}
        account={<AccountControl view={view} />}
      />
      <main className="min-w-0 flex-1">{children}</main>
      <SwRegister />
    </div>
  )
}
