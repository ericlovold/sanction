import { getViewWallet, listSessionWallets } from "@/lib/session"
import { db } from "@/lib/db"
import { subtreeWalletIds } from "@/lib/walletSubtree"
import { AccountControl } from "@/components/account-control"
import { DashboardSidebar } from "@/components/dashboard-sidebar"
import { WalletSwitcher } from "@/components/wallet-switcher"
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
  // on the Approvals page itself, where timeouts are actually visible. Count
  // across the subtree so the badge matches the (subtree-aware) Approvals page —
  // and match its LIVE set: an escalation past its expiry is no longer
  // actionable (the page filters it, and a sweep will settle it fail-closed), so
  // counting it here would put a number on the badge the page can never clear.
  const now = new Date()
  const { ids: walletIds } = await subtreeWalletIds(view.id)
  const [pendingCount, childWallets, sessionWallets] = await Promise.all([
    db.pendingApproval.count({
      where: { walletId: { in: walletIds }, status: "pending", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    }),
    db.wallet.count({ where: { parentId: view.id } }),
    view.isSession ? listSessionWallets() : Promise.resolve([]),
  ])

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <DashboardSidebar
        view={{ name: view.name, isSession: view.isSession }}
        pendingCount={pendingCount}
        hasPools={childWallets > 0}
        account={<AccountControl view={view} />}
        switcher={sessionWallets.length > 1 ? <WalletSwitcher wallets={sessionWallets} activeId={view.id} /> : undefined}
      />
      <main className="min-w-0 flex-1">{children}</main>
      <SwRegister />
      {process.env.NODE_ENV !== "production" && (
        // Dev-only self-heal for a browser poisoned by the (production) service
        // worker: dev chunks aren't immutable, so a cache-first SW serves stale
        // bundles and the page hydration-mismatches. This must be INLINE in the
        // document — navigations are the one thing the SW never caches — because
        // a stale SW would serve the old version of any static chunk that tried
        // to carry this fix. Reloads once after unregistering so the page picks
        // up fresh chunks; no registrations → no reload → no loop.
        <script
          dangerouslySetInnerHTML={{
            __html:
              "if('serviceWorker'in navigator){var wipe=function(){return'caches'in window?caches.keys().then(function(ks){return Promise.all(ks.map(function(k){return caches.delete(k)}))}):Promise.resolve()};navigator.serviceWorker.getRegistrations().then(function(rs){if(rs.length){Promise.all(rs.map(function(r){return r.unregister()})).then(wipe).then(function(){location.reload()})}else{wipe()}})}",
          }}
        />
      )}
    </div>
  )
}
