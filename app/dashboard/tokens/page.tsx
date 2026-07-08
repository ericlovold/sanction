import type { Metadata } from "next"
import Link from "next/link"
import { db } from "@/lib/db"
import { NoWallet } from "@/components/no-wallet"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { revokeExecutionTokenAction } from "@/app/dashboard/tokens/actions"
import { getViewWallet } from "@/lib/session"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Execution Tokens — Sanction",
  description: "Observe and revoke short-lived execution authority tokens.",
}

export default async function TokensPage() {
  const view = await getViewWallet()
  if (!view) return <NoWallet />
  const tokens = await db.executionToken.findMany({
    where: { walletId: view.id },
    orderBy: { issuedAt: "desc" },
    take: 200,
    include: { agent: { select: { name: true } } },
  })
  const active = tokens.filter((token) => token.status === "active" && token.expiresAt > new Date()).length
  const revoked = tokens.filter((token) => token.status === "revoked").length
  const spent = tokens.reduce((sum, token) => sum + token.spentUsd, 0)

  return (
    <div className="mx-auto min-h-screen max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">Execution tokens</h1>
        <p className="mt-1 text-sm text-foreground0">
          Runtime JWT authority per execution. Revoke active tokens when a run is compromised or over-scoped.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          This extends the current token/key management flow; key lifecycle stays in{" "}
          <Link href="/dashboard/agents" className="text-signal hover:text-signal">Seats</Link>.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="border-border bg-card">
          <CardHeader className="px-4 pt-4 pb-1"><CardTitle className="text-xs font-normal text-foreground0">Active</CardTitle></CardHeader>
          <CardContent className="px-4 pb-4"><p className="font-mono text-2xl font-semibold">{active}</p></CardContent>
        </Card>
        <Card className="border-border bg-card">
          <CardHeader className="px-4 pt-4 pb-1"><CardTitle className="text-xs font-normal text-foreground0">Revoked</CardTitle></CardHeader>
          <CardContent className="px-4 pb-4"><p className="font-mono text-2xl font-semibold">{revoked}</p></CardContent>
        </Card>
        <Card className="border-border bg-card">
          <CardHeader className="px-4 pt-4 pb-1"><CardTitle className="text-xs font-normal text-foreground0">Spent authority</CardTitle></CardHeader>
          <CardContent className="px-4 pb-4"><p className="font-mono text-2xl font-semibold">${spent.toFixed(2)}</p></CardContent>
        </Card>
      </div>

      <div className="space-y-2">
        {tokens.length === 0 && (
          <p className="rounded-lg border border-border bg-card p-6 text-center text-sm text-foreground0">
            No execution tokens issued yet.
          </p>
        )}
        {tokens.map((token) => {
          const expired = token.expiresAt <= new Date()
          const status =
            token.status === "revoked"
              ? "revoked"
              : token.status === "completed"
                ? "completed"
                : expired
                  ? "expired"
                  : "active"
          return (
            <Card key={token.id} className="border-border bg-card">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs text-muted-foreground">{token.id}</p>
                  <p className="mt-1 text-sm text-foreground">
                    {token.agent.name} · ${token.spentUsd.toFixed(2)} / ${token.budgetUsd.toFixed(2)} · clearance {token.clearance}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    issued {token.issuedAt.toLocaleString()} · expires {token.expiresAt.toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded border px-2 py-0.5 text-[10px] ${
                      status === "active"
                        ? "border-signal/25 bg-signal/10 text-signal"
                        : status === "revoked"
                          ? "border-red-500/20 bg-red-500/10 text-red-300"
                          : "border-input bg-muted text-muted-foreground"
                    }`}
                  >
                    {status}
                  </span>
                  {view.isSession && status === "active" && (
                    <form action={revokeExecutionTokenAction}>
                      <input type="hidden" name="id" value={token.id} />
                      <button type="submit" className="rounded border border-red-500/40 px-2.5 py-1 text-xs text-red-300 hover:text-red-200">
                        Revoke
                      </button>
                    </form>
                  )}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
