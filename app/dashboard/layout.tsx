import { getViewWallet } from "@/lib/session"
import { listPendingApprovals } from "@/lib/approvals"
import { AccountControl } from "@/components/account-control"
import { DashboardSidebar } from "@/components/dashboard-sidebar"

export const dynamic = "force-dynamic"

// Console shell. Wraps every /dashboard/* page in a persistent sidebar so the
// dashboard reads as one console instead of four standalone pages. When there's
// no wallet in context we render the page bare — the page shows its own
// full-screen "log in / create a wallet" prompt without the chrome.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const view = await getViewWallet()
  if (!view) return <>{children}</>

  const pendingCount = (await listPendingApprovals(view.id)).length

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <DashboardSidebar
        view={{ name: view.name, isSession: view.isSession }}
        pendingCount={pendingCount}
        account={<AccountControl view={view} />}
      />
      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-5xl space-y-6 p-6">{children}</div>
      </main>
    </div>
  )
}
