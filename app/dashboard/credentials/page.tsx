import type { Metadata } from "next"
import { db } from "@/lib/db"
import { NoWallet } from "@/components/no-wallet"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  createCredentialAction,
  revokeCredentialAction,
  updateCredentialAccessAction,
} from "@/app/dashboard/credentials/actions"
import { getViewWallet } from "@/lib/session"
import { subtreeWalletIds } from "@/lib/walletSubtree"
import { hasRole } from "@/lib/roles"

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
  const [credentials, walletRows] = await Promise.all([
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
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="border-border bg-card">
          <CardHeader className="px-4 pt-4 pb-1"><CardTitle className="text-xs font-normal text-muted-foreground">Active credentials</CardTitle></CardHeader>
          <CardContent className="px-4 pb-4"><p className="font-mono text-2xl font-semibold">{active}</p></CardContent>
        </Card>
        <Card className="border-border bg-card">
          <CardHeader className="px-4 pt-4 pb-1"><CardTitle className="text-xs font-normal text-muted-foreground">Retired credentials</CardTitle></CardHeader>
          <CardContent className="px-4 pb-4"><p className="font-mono text-2xl font-semibold">{credentials.length - active}</p></CardContent>
        </Card>
      </div>

      {hasRole(view.role, "admin") && (
        <Card className="border-border bg-muted">
          <CardHeader className="px-4 pt-4 pb-2"><CardTitle className="text-sm text-muted-foreground">Add credential</CardTitle></CardHeader>
          <CardContent className="px-4 pb-4">
            <form action={createCredentialAction} className="space-y-3">
              {/* The two fields every credential needs; everything else defaults sanely. */}
              <div className="grid gap-2 md:grid-cols-3">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Label</span>
                  <input name="label" required placeholder="e.g. OpenAI prod key" className="w-full rounded border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-border" />
                </label>
                <label className="block md:col-span-2">
                  <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Secret value</span>
                  <input name="value" type="password" autoComplete="new-password" required placeholder="pasted once, encrypted at rest, never shown again" className="w-full rounded border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-border" />
                </label>
              </div>
              <details className="rounded border border-border/60">
                <summary className="cursor-pointer select-none px-3 py-2 text-xs text-muted-foreground hover:text-foreground">
                  Access controls — type, clearance, expiry, seat allowlist, scopes (defaults: api_key · clearance 1 · every seat)
                </summary>
                <div className="grid gap-2 border-t border-border/60 px-3 py-3 md:grid-cols-3">
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Type</span>
                    <select name="type" defaultValue="api_key" className="w-full rounded border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-border">
                      <option value="api_key">api_key</option>
                      <option value="oauth_token">oauth_token</option>
                      <option value="certificate">certificate</option>
                      <option value="license">license</option>
                      <option value="password">password</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Min clearance (1–5)</span>
                    <input name="min_clearance" type="number" min={1} max={5} defaultValue={1} className="w-full rounded border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-border" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Expires</span>
                    <input name="expires_at" type="date" className="w-full rounded border border-border bg-card px-3 py-2 text-sm text-muted-foreground outline-none focus:border-border" />
                  </label>
                  <label className="block md:col-span-2">
                    <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Limit to seats — agent ids, comma-separated (blank = every seat)</span>
                    <input name="allowed_agent_ids" placeholder="blank = every seat may inject it" className="w-full rounded border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-border" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Scopes — comma-separated</span>
                    <input name="scopes" placeholder="e.g. read,write" className="w-full rounded border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-border" />
                  </label>
                </div>
              </details>
              <button type="submit" className="w-fit rounded bg-emerald-500 px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-emerald-400">
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
                  <form action={updateCredentialAccessAction} className="grid gap-2 md:grid-cols-4">
                    <input type="hidden" name="id" value={credential.id} />
                    <label className="block md:col-span-2">
                      <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Limit to seats (agent ids, csv — blank = all)</span>
                      <input
                        name="allowed_agent_ids"
                        defaultValue={credential.allowedAgentIds.join(",")}
                        placeholder="blank = every seat"
                        className="w-full rounded border border-border bg-card px-2 py-1.5 text-xs text-foreground outline-none focus:border-border"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Scopes (csv)</span>
                      <input
                        name="scopes"
                        defaultValue={credential.scopes.join(",")}
                        placeholder="e.g. read,write"
                        className="w-full rounded border border-border bg-card px-2 py-1.5 text-xs text-foreground outline-none focus:border-border"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Min clearance</span>
                      <input
                        name="min_clearance"
                        type="number"
                        min={1}
                        max={5}
                        defaultValue={credential.minClearance}
                        className="w-full rounded border border-border bg-card px-2 py-1.5 text-xs text-foreground outline-none focus:border-border"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Expires</span>
                      <input
                        name="expires_at"
                        type="date"
                        defaultValue={credential.expiresAt ? credential.expiresAt.toISOString().slice(0, 10) : ""}
                        className="w-full rounded border border-border bg-card px-2 py-1.5 text-xs text-foreground outline-none focus:border-border"
                      />
                    </label>
                    <div className="md:col-span-4">
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
