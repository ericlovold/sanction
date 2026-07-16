import type { Metadata } from "next"
import Link from "next/link"
import { db } from "@/lib/db"
import { NoWallet } from "@/components/no-wallet"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  createCredentialAction,
  revokeCredentialAction,
  updateCredentialAccessAction,
} from "@/app/dashboard/credentials/actions"
import { getViewWallet } from "@/lib/session"
import { hasRole } from "@/lib/roles"
import { subtreeWalletIds } from "@/lib/walletSubtree"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Credentials — Sanction",
  description: "Manage vault credentials, agent allowlists, and clearance gates.",
}

export default async function CredentialsPage() {
  const view = await getViewWallet()
  if (!view) return <NoWallet />
  // Roll up the subtree — the org's vault, pool by pool. Leaf subtree = self, no
  // change. The same explicit walletId filter the page already used, widened.
  const { ids: walletIds } = await subtreeWalletIds(view.id)
  const multiPool = walletIds.length > 1
  const [credentials, agents, walletRows] = await Promise.all([
    db.credentialVault.findMany({
      where: { walletId: { in: walletIds } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        walletId: true,
        label: true,
        type: true,
        scopes: true,
        allowedAgentIds: true,
        minClearance: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
      },
    }),
    db.agent.findMany({
      where: { walletId: { in: walletIds } },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, holder: true },
    }),
    db.wallet.findMany({ where: { id: { in: walletIds } }, select: { id: true, name: true } }),
  ])
  const poolName = new Map(walletRows.map((w) => [w.id, w.name]))
  const active = credentials.filter((c) => !c.revokedAt).length

  return (
    <div className="mx-auto min-h-screen max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">Credential vault</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Secrets stay encrypted at rest; this page controls which seats can inject them and at what clearance.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          This is an additive leadership surface inside the same dashboard/PWA shell. Seat lifecycle remains in{" "}
          <Link href="/dashboard/agents" className="text-emerald-400 hover:text-primary">Seats</Link>.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="border-border bg-card">
          <CardHeader className="px-4 pt-4 pb-1"><CardTitle className="text-xs font-normal text-muted-foreground">Active credentials</CardTitle></CardHeader>
          <CardContent className="px-4 pb-4"><p className="font-mono text-2xl font-semibold">{active}</p></CardContent>
        </Card>
        <Card className="border-border bg-card">
          <CardHeader className="px-4 pt-4 pb-1"><CardTitle className="text-xs font-normal text-muted-foreground">Retired credentials</CardTitle></CardHeader>
          <CardContent className="px-4 pb-4"><p className="font-mono text-2xl font-semibold">{credentials.length - active}</p></CardContent>
        </Card>
        <Card className="border-border bg-card">
          <CardHeader className="px-4 pt-4 pb-1"><CardTitle className="text-xs font-normal text-muted-foreground">Seat roster</CardTitle></CardHeader>
          <CardContent className="px-4 pb-4"><p className="font-mono text-2xl font-semibold">{agents.length}</p></CardContent>
        </Card>
      </div>

      {hasRole(view.role, "admin") && (
        <Card className="border-border bg-muted">
          <CardHeader className="px-4 pt-4 pb-2"><CardTitle className="text-sm text-muted-foreground">Add credential</CardTitle></CardHeader>
          <CardContent className="px-4 pb-4">
            <form action={createCredentialAction} className="grid gap-2 md:grid-cols-3">
              <input name="label" required placeholder="OpenAI prod key" className="rounded border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-border" />
              <select name="type" defaultValue="api_key" className="rounded border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-border">
                <option value="api_key">api_key</option>
                <option value="oauth_token">oauth_token</option>
                <option value="certificate">certificate</option>
                <option value="license">license</option>
                <option value="password">password</option>
              </select>
              <input name="min_clearance" type="number" min={1} max={5} defaultValue={1} className="rounded border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-border" />
              <input name="value" required placeholder="secret value" className="rounded border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-border md:col-span-2" />
              <input name="expires_at" type="date" className="rounded border border-border bg-card px-3 py-2 text-sm text-muted-foreground outline-none focus:border-border" />
              <input name="allowed_agent_ids" placeholder="allowed agent ids (csv, blank = all)" className="rounded border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-border md:col-span-2" />
              <input name="scopes" placeholder="scopes (csv)" className="rounded border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-border" />
              <button type="submit" className="w-fit rounded bg-emerald-500 px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-emerald-400 md:col-span-3">
                Save credential
              </button>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {credentials.length === 0 && (
          <p className="rounded-lg border border-border bg-muted p-6 text-center text-sm text-muted-foreground">
            No credentials in this wallet yet.
          </p>
        )}
        {credentials.map((credential) => (
          <Card key={credential.id} className="border-border bg-muted">
            <CardContent className="space-y-3 px-4 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-foreground">{credential.label}</p>
                <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">{credential.type}</span>
                <span
                  className={`rounded border px-1.5 py-0.5 text-[10px] ${
                    credential.revokedAt
                      ? "border-red-500/20 bg-red-500/10 text-red-300"
                      : "border-emerald-500/20 bg-emerald-500/10 text-primary"
                  }`}
                >
                  {credential.revokedAt ? "retired" : "active"}
                </span>
                {multiPool && (
                  <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {poolName.get(credential.walletId) ?? "pool"}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                clearance ≥ {credential.minClearance} ·{" "}
                {credential.allowedAgentIds.length === 0 ? "all seats" : `${credential.allowedAgentIds.length} allowlisted`}
                {credential.expiresAt ? ` · expires ${credential.expiresAt.toLocaleDateString()}` : ""}
              </p>
              {hasRole(view.role, "admin") && !credential.revokedAt && credential.walletId === view.id && (
                <div className="space-y-2">
                  <form action={updateCredentialAccessAction} className="grid gap-2 md:grid-cols-3">
                    <input type="hidden" name="id" value={credential.id} />
                    <input
                      name="allowed_agent_ids"
                      defaultValue={credential.allowedAgentIds.join(",")}
                      placeholder="allowed agent ids (csv)"
                      className="rounded border border-border bg-card px-2 py-1.5 text-xs text-foreground outline-none focus:border-border md:col-span-2"
                    />
                    <input
                      name="scopes"
                      defaultValue={credential.scopes.join(",")}
                      placeholder="scopes (csv)"
                      className="rounded border border-border bg-card px-2 py-1.5 text-xs text-foreground outline-none focus:border-border"
                    />
                    <input
                      name="min_clearance"
                      type="number"
                      min={1}
                      max={5}
                      defaultValue={credential.minClearance}
                      className="rounded border border-border bg-card px-2 py-1.5 text-xs text-foreground outline-none focus:border-border"
                    />
                    <input
                      name="expires_at"
                      type="date"
                      defaultValue={credential.expiresAt ? credential.expiresAt.toISOString().slice(0, 10) : ""}
                      className="rounded border border-border bg-card px-2 py-1.5 text-xs text-foreground outline-none focus:border-border"
                    />
                    <div className="md:col-span-3">
                      <button type="submit" className="rounded border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground">
                        Save access
                      </button>
                    </div>
                  </form>
                  <form action={revokeCredentialAction}>
                    <input type="hidden" name="id" value={credential.id} />
                    <button type="submit" className="rounded border border-red-500/40 px-2.5 py-1 text-xs text-red-300 hover:text-red-200">
                      Retire
                    </button>
                  </form>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
