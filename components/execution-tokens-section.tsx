import { db } from "@/lib/db"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { revokeExecutionTokenAction } from "@/app/dashboard/tokens/actions"
import { subtreeWalletIds } from "@/lib/walletSubtree"

// Execution tokens, as a section of Seats (they ARE seat activity: the
// short-lived JWT a seat holds for one run). Formerly its own page at
// /dashboard/tokens — that URL still lands here via redirect.
export async function ExecutionTokensSection({ rootWalletId, editable }: { rootWalletId: string; editable: boolean }) {
  const { ids: walletIds } = await subtreeWalletIds(rootWalletId)
  const tokens = await db.executionToken.findMany({
    where: { walletId: { in: walletIds } },
    orderBy: { issuedAt: "desc" },
    take: 50,
    include: { agent: { select: { name: true, wallet: { select: { name: true } } } } },
  })
  const multiPool = walletIds.length > 1
  const now = new Date()

  return (
    <Card id="execution-tokens" className="border-border bg-card">
      <CardHeader className="px-5 pt-5 pb-2">
        <CardTitle className="text-sm font-medium text-foreground">Execution tokens</CardTitle>
        <p className="text-xs text-muted-foreground">
          Runtime JWT authority per execution. Revoke an active token when a run is compromised or over-scoped.
        </p>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        {tokens.length === 0 && (
          <p className="text-sm text-muted-foreground">No execution tokens issued yet.</p>
        )}
        <div className="space-y-2">
          {tokens.map((token) => {
            const expired = token.expiresAt <= now
            const status =
              token.status === "revoked"
                ? "revoked"
                : token.status === "completed"
                  ? "completed"
                  : expired
                    ? "expired"
                    : "active"
            return (
              <div key={token.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs text-muted-foreground">{token.id}</p>
                  <p className="mt-1 text-sm text-foreground">
                    {token.agent.name}
                    {multiPool && <span className="text-muted-foreground"> · {token.agent.wallet.name}</span>} · ${token.spentUsd.toFixed(2)} / ${token.budgetUsd.toFixed(2)} · clearance {token.clearance}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    issued {token.issuedAt.toLocaleString()} · expires {token.expiresAt.toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded border px-2 py-0.5 text-[10px] ${
                      status === "active"
                        ? "border-emerald-500/20 bg-emerald-500/10 text-primary"
                        : status === "revoked"
                          ? "border-red-500/20 bg-red-500/10 text-red-300"
                          : "border-border bg-muted text-muted-foreground"
                    }`}
                  >
                    {status}
                  </span>
                  {editable && status === "active" && (
                    <form action={revokeExecutionTokenAction}>
                      <input type="hidden" name="id" value={token.id} />
                      <button type="submit" className="rounded border border-red-500/40 px-2.5 py-1 text-xs text-red-300 hover:text-red-200">
                        Revoke
                      </button>
                    </form>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
