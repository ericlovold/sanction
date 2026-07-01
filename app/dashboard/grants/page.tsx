import type { Metadata } from "next"
import Link from "next/link"
import { db } from "@/lib/db"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { AccountControl } from "@/components/account-control"
import { DashboardNav } from "@/components/dashboard-nav"
import { getViewWallet } from "@/lib/session"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Sanction — Grants",
  description: "Audit issued authority for governed agent actions.",
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function actionLabel(actionType: string) {
  return actionType
    .split(".")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function resourceTitle(resource: Record<string, unknown>, actionType: string) {
  if (resource.kind === "spend") {
    const amount = numberValue(resource.amount_usd)
    const merchant = stringValue(resource.merchant) ?? "Unknown merchant"
    return amount === null ? merchant : `$${amount.toFixed(2)} ${merchant}`
  }
  if (resource.kind === "provision") {
    const quantity = numberValue(resource.quantity)
    const lineItem = stringValue(resource.line_item) ?? "Unknown item"
    const amount = numberValue(resource.amount_usd)
    const res = stringValue(resource.resource)
    const head = quantity === null ? lineItem : `${quantity} × ${lineItem}`
    return `${head}${amount === null ? "" : ` — $${amount.toFixed(2)}`}${res ? ` (${res})` : ""}`
  }
  return (
    stringValue(resource.label) ??
    stringValue(resource.tool_name) ??
    stringValue(resource.credential_label) ??
    stringValue(resource.name) ??
    actionLabel(actionType)
  )
}

function constraintSummary(resource: Record<string, unknown>, constraints: Record<string, unknown>) {
  const pieces = []
  if (constraints.one_use === true) pieces.push("one use")
  const amount = numberValue(constraints.max_amount_usd) ?? numberValue(resource.amount_usd)
  if (amount !== null) pieces.push(`max $${amount.toFixed(2)}`)
  const category = stringValue(resource.category)
  if (category) pieces.push(category)
  return pieces.join(" · ")
}

function displayStatus(status: string, expiresAt: Date | null) {
  if (status === "active" && expiresAt && expiresAt.getTime() < Date.now()) return "expired"
  return status
}

const statusClasses: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  consumed: "bg-zinc-500/15 text-zinc-400 border-zinc-500/20",
  expired: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  revoked: "bg-red-500/15 text-red-400 border-red-500/20",
}

export default async function GrantsPage() {
  const view = await getViewWallet()
  if (!view) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="space-y-3 text-center">
          <p className="text-sm text-zinc-400">No wallet to show.</p>
          <div className="flex items-center justify-center gap-3 text-sm">
            <Link href="/login" className="text-emerald-400 hover:text-emerald-300">Log in</Link>
            <Link href="/start" className="text-zinc-400 hover:text-zinc-200">Create a wallet</Link>
          </div>
        </div>
      </div>
    )
  }

  const grants = await db.grant.findMany({
    where: { walletId: view.id },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      agent: { select: { name: true } },
      issuedFromApproval: { select: { id: true, status: true } },
    },
  })
  const activeCount = grants.filter((g) => displayStatus(g.status, g.expiresAt) === "active").length
  const consumedCount = grants.filter((g) => displayStatus(g.status, g.expiresAt) === "consumed").length
  const expiredCount = grants.filter((g) => displayStatus(g.status, g.expiresAt) === "expired").length
  const revokedCount = grants.filter((g) => displayStatus(g.status, g.expiresAt) === "revoked").length
  const sections = [
    { status: "active", title: "Active", grants: grants.filter((g) => displayStatus(g.status, g.expiresAt) === "active") },
    { status: "consumed", title: "Consumed", grants: grants.filter((g) => displayStatus(g.status, g.expiresAt) === "consumed") },
    { status: "expired", title: "Expired", grants: grants.filter((g) => displayStatus(g.status, g.expiresAt) === "expired") },
    { status: "revoked", title: "Revoked", grants: grants.filter((g) => displayStatus(g.status, g.expiresAt) === "revoked") },
  ]

  return (
    <div className="min-h-screen max-w-6xl mx-auto space-y-6 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <Link href="/" className="font-display text-xl font-semibold tracking-tight hover:text-zinc-300 transition-colors">Sanction</Link>
          <p className="text-sm text-zinc-500">{view.name} · issued human authority</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {activeCount > 0 && (
            <Badge className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
              {activeCount} active grant{activeCount > 1 ? "s" : ""}
            </Badge>
          )}
          <DashboardNav active="grants" />
          <AccountControl view={view} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Active", activeCount, activeCount > 0 ? "text-emerald-300" : ""],
          ["Consumed", consumedCount, ""],
          ["Expired", expiredCount, expiredCount > 0 ? "text-amber-300" : ""],
          ["Revoked", revokedCount, revokedCount > 0 ? "text-red-300" : ""],
        ].map(([label, value, tone]) => (
          <Card key={label} className="bg-zinc-900 border-zinc-800">
            <CardHeader className="px-4 pt-4 pb-1">
              <CardTitle className="text-xs font-normal text-zinc-500">{label}</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className={`font-mono text-2xl font-semibold ${tone}`}>{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {grants.length === 0 && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="px-4 py-8">
            <p className="text-center text-sm text-zinc-600">No grants issued yet</p>
          </CardContent>
        </Card>
      )}

      {sections.map((section) => (
        section.grants.length > 0 && (
          <Card key={section.status} className="bg-zinc-900 border-zinc-800">
            <CardHeader className="px-4 pt-4 pb-2">
              <CardTitle className="text-sm font-medium text-zinc-300">{section.title}</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="divide-y divide-zinc-800">
                {section.grants.map((grant) => {
                  const resource = asRecord(grant.resourceJson)
                  const constraints = asRecord(grant.constraintsJson)
                  const status = displayStatus(grant.status, grant.expiresAt)
                  const constraintsText = constraintSummary(resource, constraints)

                  return (
                    <div key={grant.id} className="flex flex-col gap-3 py-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500">
                            {actionLabel(grant.actionType)}
                          </span>
                          <p className="truncate text-sm font-medium text-zinc-200">{resourceTitle(resource, grant.actionType)}</p>
                        </div>
                        <p className="mt-1 text-xs text-zinc-600">
                          {grant.agent.name} · issued {grant.createdAt.toLocaleString()}
                          {grant.expiresAt ? ` · expires ${grant.expiresAt.toLocaleString()}` : ""}
                          {grant.consumedAt ? ` · consumed ${grant.consumedAt.toLocaleString()}` : ""}
                        </p>
                        {constraintsText && <p className="mt-1 text-xs text-zinc-500">{constraintsText}</p>}
                        {grant.justification && <p className="mt-1 text-xs text-zinc-500">&quot;{grant.justification}&quot;</p>}
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        {grant.issuedFromApproval && (
                          <span className="font-mono text-[10px] text-zinc-600">{grant.issuedFromApproval.id.slice(0, 10)}</span>
                        )}
                        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${statusClasses[status] ?? statusClasses.consumed}`}>
                          {status}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )
      ))}
    </div>
  )
}
