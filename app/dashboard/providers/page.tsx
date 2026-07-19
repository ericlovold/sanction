import type { Metadata } from "next"
import Link from "next/link"
import { db } from "@/lib/db"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { NoWallet } from "@/components/no-wallet"
import { getViewWallet } from "@/lib/session"
import { subtreeWalletIds } from "@/lib/walletSubtree"
import { fmtUsd } from "@/lib/format"
import { hasRole } from "@/lib/roles"
import { PROVIDERS, providerNameOf } from "@/lib/providers"
import { connectProviderAction, disconnectProviderAction } from "./actions"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Sanction — Providers",
  description: "Connect Anthropic, OpenAI, Google, and more — one key in the vault, every call governed.",
}

function startOfMonth(): Date {
  const d = new Date()
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d
}

export default async function ProvidersPage() {
  const view = await getViewWallet()
  if (!view) return <NoWallet />
  const isAdmin = hasRole(view.role, "admin")

  const { ids: walletIds } = await subtreeWalletIds(view.id)
  const agents = await db.agent.findMany({ where: { walletId: { in: walletIds } }, select: { id: true } })
  const agentIds = agents.map((a) => a.id)

  const [connections, modelGroups] = await Promise.all([
    db.credentialVault.findMany({
      where: { walletId: view.id, label: { startsWith: "provider:" }, revokedAt: null },
      select: { label: true, createdAt: true },
    }),
    db.tokenLog.groupBy({
      by: ["model"],
      where: { agentId: { in: agentIds }, createdAt: { gte: startOfMonth() } },
      _sum: { costUsd: true },
    }),
  ])
  const connectedLabels = new Set(connections.map((c) => c.label))
  const spendByProvider = new Map<string, number>()
  for (const g of modelGroups) {
    const name = providerNameOf(g.model)
    spendByProvider.set(name, (spendByProvider.get(name) ?? 0) + (g._sum.costUsd ?? 0))
  }

  return (
    <div className="min-h-screen p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Providers</h1>
        <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
          Connect a provider once — the key is encrypted into your vault and never leaves it.
          Your agents then need only their Sanction seat key: point the SDK at the gateway URL
          and every call is metered, budgeted, and on the signed record.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {PROVIDERS.map((p) => {
          const connected = connectedLabels.has(p.vaultLabel)
          const monthSpend = spendByProvider.get(p.name) ?? 0
          return (
            <Card key={p.id} className="bg-card border-border">
              <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <span aria-hidden className="h-2.5 w-2.5 rounded-[3px]" style={{ background: p.color }} />
                  {p.name}
                </CardTitle>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[11px] ${
                    connected
                      ? "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-400"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  {connected ? "Connected" : "Not connected"}
                </span>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-3">
                <p className="text-xs text-muted-foreground">
                  This month through the gateway: <span className="font-mono text-foreground">{fmtUsd(monthSpend)}</span>
                </p>

                <div className="rounded-md bg-muted/60 p-3 text-[11px] font-mono leading-relaxed overflow-x-auto">
                  <p className="text-muted-foreground"># point your SDK at the gateway</p>
                  <p>base_url = https://getsanction.com/api/gateway/{p.id}</p>
                  <p>x-sanction-key: pxy_&lt;your seat key&gt;</p>
                  <p className="text-muted-foreground mt-1"># e.g. POST /{p.examplePath} · model {p.exampleModel}</p>
                  {!connected && (
                    <p className="text-muted-foreground mt-1"># not connected: also send your own {p.name} auth header</p>
                  )}
                  {connected && (
                    <p className="text-emerald-500/80 mt-1"># connected: Sanction injects the {p.name} key server-side</p>
                  )}
                </div>

                {isAdmin ? (
                  connected ? (
                    <div className="flex items-center gap-3">
                      <form action={connectProviderAction} className="flex flex-1 gap-2">
                        <input type="hidden" name="provider" value={p.id} />
                        <input
                          name="api_key"
                          type="password"
                          required
                          placeholder="Rotate — paste a new key"
                          className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                        />
                        <button type="submit" className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted">
                          Rotate
                        </button>
                      </form>
                      <form action={disconnectProviderAction}>
                        <input type="hidden" name="provider" value={p.id} />
                        <button type="submit" className="rounded-md border border-red-500/30 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/[0.06]">
                          Disconnect
                        </button>
                      </form>
                    </div>
                  ) : (
                    <form action={connectProviderAction} className="flex gap-2">
                      <input type="hidden" name="provider" value={p.id} />
                      <input
                        name="api_key"
                        type="password"
                        required
                        placeholder={`Paste your ${p.name} API key`}
                        className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                      />
                      <button type="submit" className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
                        Connect
                      </button>
                    </form>
                  )
                ) : (
                  <p className="text-xs text-muted-foreground">An admin can connect or rotate this provider.</p>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        Connected keys live in the <Link href="/dashboard/credentials" className="underline underline-offset-2">credential vault</Link> under
        reserved <span className="font-mono">provider:*</span> labels — encrypted, rotation-in-one-step, never injectable by agents.
      </p>
    </div>
  )
}
