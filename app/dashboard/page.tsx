import type { Metadata } from "next"
import Link from "next/link"
import { db } from "@/lib/db"
import { NoWallet } from "@/components/no-wallet"
import { RosterAddAgent } from "@/components/roster-add-agent"
import { getViewWallet } from "@/lib/session"
import { fmtUsd } from "@/lib/format"
import { hasRole } from "@/lib/roles"
import { getRoster, type RosterAgent, type RosterGroup } from "@/lib/roster"
import { OnboardingTour, TourLauncher } from "./onboarding-tour"
import { FunnelBeacon } from "@/components/funnel-beacon"
import { FUNNEL } from "@/lib/funnel"
import "./roster.css"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Sanction — Roster",
  description: "The agents and groups on this wallet.",
}

function Stamp({ stamp }: { stamp: RosterAgent["stamp"] }) {
  return <span className={`roster-stamp roster-stamp-${stamp}`}>{stamp}</span>
}

function AgentCard({ agent }: { agent: RosterAgent }) {
  return (
    <Link
      href="/dashboard/agents"
      data-tour="roster-agent"
      className="block border border-[var(--roster-rule)] bg-[var(--roster-paper)] px-4 py-3 transition-colors hover:border-[var(--roster-brass)]"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="truncate text-sm font-medium text-[var(--roster-signal)]">{agent.name}</p>
        <Stamp stamp={agent.stamp} />
      </div>
      <p className="mt-2 font-mono text-xs text-[var(--roster-fog)]">
        {fmtUsd(agent.monthUsd)} this month
        {agent.holder ? ` · ${agent.holder}` : ""}
      </p>
    </Link>
  )
}

function GroupCard({
  group,
  canAdd,
  depth,
}: {
  group: RosterGroup
  canAdd: boolean
  depth: number
}) {
  const cap =
    group.spendCapUsd != null ? `${fmtUsd(group.monthUsd)} / ${fmtUsd(group.spendCapUsd)}` : `${fmtUsd(group.monthUsd)} this month`

  return (
    <section
      data-tour={depth === 0 ? "roster-root" : undefined}
      className="border border-[var(--roster-rule)] bg-[var(--roster-paper)]"
      style={depth > 0 ? { marginLeft: Math.min(depth, 3) * 16 } : undefined}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[var(--roster-rule)] px-5 py-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--roster-brass)]">
            {depth === 0 ? "Group" : "Subgroup"}
          </p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight">{group.name}</h2>
        </div>
        <p className="font-mono text-xs text-[var(--roster-fog)]">
          {cap}
          {group.pending > 0 ? ` · ${group.pending} paused` : ""}
        </p>
      </header>
      <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
        {group.agents.map((agent) => (
          <AgentCard key={agent.id} agent={agent} />
        ))}
        {canAdd ? (
          <RosterAddAgent walletId={group.id} />
        ) : (
          <a
            href="/login"
            data-tour={depth === 0 ? "roster-add" : undefined}
            className="flex min-h-[88px] w-full flex-col justify-center border border-dashed border-[var(--roster-rule)] px-4 py-3 text-left"
          >
            <span className="text-sm font-medium text-[var(--roster-signal)]">+ Agent</span>
            <span className="mt-1 text-xs text-[var(--roster-fog)]">Log in to create one in this group.</span>
          </a>
        )}
      </div>
      {group.children.length > 0 && (
        <div className="space-y-3 border-t border-[var(--roster-rule)] p-4">
          {group.children.map((child) => (
            <GroupCard key={child.id} group={child} canAdd={canAdd} depth={depth + 1} />
          ))}
        </div>
      )}
    </section>
  )
}

export default async function Dashboard() {
  const view = await getViewWallet()
  if (!view) return <NoWallet />

  if (!view.isSession && process.env.SANCTION_WALLET_ID === view.id) {
    await db.policy.updateMany({
      where: { walletId: view.id, monthlyTokenBudgetUsd: null },
      data: { monthlyTokenBudgetUsd: 100_000, monthlySpendBudgetUsd: 1_000_000 },
    })
  }

  const roster = await getRoster(view.id)
  const isDemo = !view.isSession && process.env.SANCTION_WALLET_ID === view.id
  const canAdd = hasRole(view.role, "admin")

  return (
    <div className="roster px-6 py-8">
      {isDemo && <FunnelBeacon event={FUNNEL.demoView} />}
      <OnboardingTour autoStart={isDemo || roster.agentCount === 0} />

      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--roster-brass)]">Roster</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">{view.name}</h1>
            <p className="mt-2 text-sm text-[var(--roster-fog)]">
              {roster.agentCount} {roster.agentCount === 1 ? "agent" : "agents"}
              {roster.root.children.length > 0
                ? ` · ${roster.root.children.length} ${roster.root.children.length === 1 ? "group" : "groups"}`
                : ""}
            </p>
          </div>
          <TourLauncher />
        </div>

        {roster.pendingTotal > 0 && (
          <Link
            href="/dashboard/approvals"
            className="block border border-[color-mix(in_srgb,var(--roster-paused)_45%,var(--roster-rule))] px-4 py-3 text-sm text-[var(--roster-paused)]"
          >
            {roster.pendingTotal} paused for your decision — review →
          </Link>
        )}

        <GroupCard group={roster.root} canAdd={canAdd} depth={0} />
      </div>
    </div>
  )
}
