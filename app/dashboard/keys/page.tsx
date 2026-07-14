import type { Metadata } from "next"
import Link from "next/link"
import { db } from "@/lib/db"
import { Card, CardContent } from "@/components/ui/card"
import { NoWallet } from "@/components/no-wallet"
import { ManagementKeyCard } from "@/components/management-key-card"
import { WalletIdField } from "@/components/wallet-id-field"
import { getViewWallet } from "@/lib/session"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "API Keys — Sanction",
  description: "Reset your master management key and manage agent API keys.",
}

// The one obvious place to manage every key this account has: the master
// management key (sk_) with a self-serve reset, and the per-agent data-plane
// keys (pxy_). Losing the admin key must be a one-click recovery, not a support
// ticket — so this page is loud and the reset is front and center.
export default async function ApiKeysPage() {
  const view = await getViewWallet()
  if (!view) return <NoWallet />

  const [wallet, agents] = await Promise.all([
    db.wallet.findUnique({ where: { id: view.id }, select: { mgmtKeyPrefix: true } }),
    db.agent.findMany({
      where: { walletId: view.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, apiKeyPrefix: true, isActive: true, holder: true },
    }),
  ])

  return (
    <div className="mx-auto min-h-screen max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">API Keys</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every key this account uses, in one place. Reset your master admin key here, and manage each agent&rsquo;s
          data-plane key below.
        </p>
        <WalletIdField walletId={view.id} />
      </div>

      {/* The master key — the thing you must be able to reset yourself. */}
      <ManagementKeyCard prefix={wallet?.mgmtKeyPrefix ?? null} editable={view.isSession} />

      {/* Agent (data-plane) keys */}
      <Card className="border-border bg-card">
        <CardContent className="px-5 py-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-semibold tracking-tight text-foreground">Agent keys</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                The <code className="font-mono text-foreground">pxy_…</code> keys your agents use to authorize spend,
                tools, and credentials — one per seat.
              </p>
            </div>
            <Link
              href="/dashboard/agents"
              className="shrink-0 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              Rotate on Seats →
            </Link>
          </div>

          <div className="mt-4 divide-y divide-border">
            {agents.length === 0 && (
              <p className="py-3 text-sm text-muted-foreground">
                No agent keys yet.{" "}
                <Link href="/dashboard/agents" className="text-emerald-400 hover:text-primary">Create a seat →</Link>
              </p>
            )}
            {agents.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {a.name}
                    {a.holder && <span className="ml-2 text-xs text-muted-foreground">· {a.holder}</span>}
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">{a.apiKeyPrefix}••••••••</p>
                </div>
                <span
                  className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium ${
                    a.isActive
                      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                      : "border-border bg-muted text-muted-foreground"
                  }`}
                >
                  {a.isActive ? "active" : "revoked"}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Rotate, revoke, and set limits on each agent key from{" "}
            <Link href="/dashboard/agents" className="text-emerald-400 hover:text-primary">Seats</Link> — the old key
            stops working the instant you rotate.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
