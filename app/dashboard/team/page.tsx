import type { Metadata } from "next"
import { db } from "@/lib/db"
import { Card, CardContent } from "@/components/ui/card"
import { NoWallet } from "@/components/no-wallet"
import { TeamInviteForm } from "@/components/team-invite-form"
import { ManagementKeyCard } from "@/components/management-key-card"
import { WalletIdField } from "@/components/wallet-id-field"
import { getViewWallet } from "@/lib/session"
import { changeRoleAction, revokeMemberAction } from "./actions"
import { hasRole } from "@/lib/roles"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Team & access — Sanction",
  description: "Who has access to this wallet, at what role — and the management key that anchors it.",
}

const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", viewer: "Viewer" }

function StatusBadge({ status }: { status: string }) {
  const style =
    status === "active"
      ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400"
      : status === "pending"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
        : "border-border bg-muted text-muted-foreground"
  return <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${style}`}>{status}</span>
}

export default async function TeamPage() {
  const view = await getViewWallet()
  if (!view) return <NoWallet />

  const [wallet, members] = await Promise.all([
    db.wallet.findUnique({ where: { id: view.id }, select: { ownerEmail: true, mgmtKeyPrefix: true } }),
    db.walletMember.findMany({ where: { walletId: view.id, status: { not: "revoked" } }, orderBy: { createdAt: "asc" } }),
  ])

  const isOwner = view.role === "owner"

  return (
    <div className="mx-auto min-h-screen max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">Team &amp; access</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everyone with access to this wallet, and what they can do. Only the owner can invite, change roles, or revoke access.
        </p>
        <WalletIdField walletId={view.id} />
      </div>

      <Card className="border-border bg-card">
        <CardContent className="px-5 py-5">
          <div className="divide-y divide-border">
            <div className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{wallet?.ownerEmail}</p>
                <p className="text-xs text-muted-foreground">Wallet owner — created this workspace</p>
              </div>
              <span className="shrink-0 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                Owner
              </span>
            </div>

            {members.length === 0 && <p className="py-4 text-sm text-muted-foreground">No team members invited yet.</p>}

            {members.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{m.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {m.status === "pending" ? "Invited — waiting to accept" : `${ROLE_LABEL[m.role] ?? m.role}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusBadge status={m.status} />
                  {isOwner && (
                    <>
                      <form action={changeRoleAction} className="flex items-center gap-1.5">
                        <input type="hidden" name="member_id" value={m.id} />
                        <select
                          name="role"
                          defaultValue={m.role}
                          className="rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground outline-none"
                        >
                          <option value="admin">Admin</option>
                          <option value="viewer">Viewer</option>
                          <option value="owner">Owner</option>
                        </select>
                        <button type="submit" className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted">
                          Save
                        </button>
                      </form>
                      <form action={revokeMemberAction}>
                        <input type="hidden" name="member_id" value={m.id} />
                        <button type="submit" className="rounded-md border border-red-500/30 px-2 py-1 text-xs text-red-400 hover:bg-red-500/10">
                          Revoke
                        </button>
                      </form>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          {isOwner && (
            <>
              <div className="mt-5 border-t border-border pt-4">
                <h2 className="font-display text-sm font-semibold tracking-tight text-foreground">Invite someone</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  They&rsquo;ll sign in with their own Google or GitHub account — team members don&rsquo;t share the sk_ management key.
                </p>
                <TeamInviteForm />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* The root credential — the sk_ key that authorizes the management
          plane. It lives with the humans who hold it; agent keys are on Seats. */}
      <ManagementKeyCard prefix={wallet?.mgmtKeyPrefix ?? null} editable={hasRole(view.role, "admin")} />
    </div>
  )
}
