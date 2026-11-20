import type { Metadata } from "next"
import Link from "next/link"
import { db } from "@/lib/db"
import { NoWallet } from "@/components/no-wallet"
import { RosterAddAgent } from "@/components/roster-add-agent"
import { getViewWallet } from "@/lib/session"
import { fmtUsd } from "@/lib/format"
import { hasRole } from "@/lib/roles"
import { getRoster, getWaiting, type RosterGroup } from "@/lib/roster"
import { HomeAgents, type HomeGroup } from "@/components/home-agents"
import { SetupContinuation } from "@/components/setup-continuation"
import { FirstHourChecklist } from "@/components/first-hour-checklist"
import {
  looksLikeCodingAgentPack,
  shouldShowFirstHourChecklist,
  type FirstHourSignals,
} from "@/lib/firstHour"
import { hasActiveMcpConnection } from "@/lib/firstHourConnection"
import { withTenant } from "@/lib/rls"
import { OnboardingTour, TourLauncher } from "./onboarding-tour"
import { FunnelBeacon } from "@/components/funnel-beacon"
import { FUNNEL } from "@/lib/funnel"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Sanction — Home",
  description: "What is waiting for you, and the agents on this wallet.",
}

// "3 min ago" for a row. Rendered on the server only, so the words cannot
// differ between the server and the browser.
function ago(then: Date | null, now: Date): string {
  if (!then) return "Not used yet"
  const mins = Math.max(0, Math.round((now.getTime() - then.getTime()) / 60_000))
  if (mins < 1) return "Just now"
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hr ago`
  const days = Math.round(hours / 24)
  if (days < 30) return days === 1 ? "Yesterday" : `${days} days ago`
  return then.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
}

// The group tree as a flat, depth-first list: one section per group.
function flatten(group: RosterGroup, now: Date, depth = 0, out: HomeGroup[] = []): HomeGroup[] {
  out.push({
    id: group.id,
    name: group.name,
    depth,
    month:
      group.spendCapUsd != null
        ? // A cap covers the whole subtree, so compare it with the subtree's spend.
          `${fmtUsd(group.monthUsd)} of ${fmtUsd(group.spendCapUsd)}`
        : fmtUsd(group.agents.reduce((sum, a) => sum + a.monthUsd, 0)),
    waiting: group.agents.reduce((sum, a) => sum + a.pending, 0),
    agents: group.agents.map((a) => ({
      id: a.id,
      name: a.name,
      holder: a.holder,
      stamp: a.stamp,
      month: fmtUsd(a.monthUsd),
      seen: ago(a.lastUsedAt ?? null, now),
    })),
  })
  for (const child of group.children) flatten(child, now, depth + 1, out)
  return out
}

export default async function Dashboard() {
  const view = await getViewWallet()
  if (!view) return <NoWallet />

  const brokerProof = await db.brokerWalkthrough.findFirst({
    where: { ownerWalletId: view.id, completedAt: { not: null }, executionCount: 1, initialStopped: true, changedStopped: true, reuseStopped: true },
    select: { id: true },
  })
  const [roster, waiting] = await Promise.all([getRoster(view.id), getWaiting(view.id)])
  const isDemo = !view.isSession && process.env.SANCTION_WALLET_ID === view.id
  const canAdd = hasRole(view.role, "admin")

  const [policy, slackCount, webhookCount, decisionCount, tokenCount, hasMcpConnection] = await Promise.all([
    db.policy.findUnique({
      where: { walletId: view.id },
      select: { allowedTools: true, blockedTools: true, capabilityRules: true, enforcementMode: true },
    }),
    withTenant(view.id, (tx) => tx.slackInstall.count({ where: { walletId: view.id, revokedAt: null } })).catch(() => 0),
    db.webhook.count({ where: { walletId: view.id } }),
    db.authorizationRequest.count({ where: { agent: { walletId: view.id } } }),
    db.tokenLog.count({ where: { agent: { walletId: view.id } } }),
    view.isSession ? hasActiveMcpConnection(view.id) : false,
  ])

  const firstHour: FirstHourSignals = {
    hasAgent: roster.agentCount > 0,
    hasMcpConnection,
    hasDecision: decisionCount > 0,
    hasSlack: slackCount > 0,
    hasWebhook: webhookCount > 0,
    hasGatewayUsage: tokenCount > 0,
    codingAgentPackApplied: policy
      ? looksLikeCodingAgentPack({
          enforcementMode: policy.enforcementMode,
          allowedTools: policy.allowedTools,
          blockedTools: policy.blockedTools,
          capabilityRules: policy.capabilityRules,
        })
      : false,
  }
  const showFirstHour = shouldShowFirstHourChecklist(firstHour, { isSession: view.isSession, isDemo })

  const now = new Date()
  const groups = flatten(roster.root, now)
  const setupComplete = hasMcpConnection && firstHour.hasDecision
  const setup =
    view.isSession && canAdd ? (
      <SetupContinuation key={view.id} proofComplete={Boolean(brokerProof)} hasMcpConnection={hasMcpConnection} hasDecision={firstHour.hasDecision}>
        {showFirstHour && <FirstHourChecklist signals={firstHour} />}
      </SetupContinuation>
    ) : showFirstHour ? (
      <FirstHourChecklist signals={firstHour} />
    ) : null

  return (
    <div className="home">
      {isDemo && <FunnelBeacon event={FUNNEL.demoView} />}
      <OnboardingTour autoStart={isDemo || roster.agentCount === 0} canRunProof={view.isSession && canAdd} />

      <header className="home-head">
        <div>
          <h1 className="home-title">{view.name}</h1>
          <p className="home-sub">
            {roster.agentCount} {roster.agentCount === 1 ? "agent" : "agents"}
            {groups.length > 1 ? ` in ${groups.length} groups` : ""}, {fmtUsd(roster.root.monthUsd)} this month
          </p>
        </div>
        <div className="home-actions">
          <TourLauncher />
          {canAdd ? (
            <RosterAddAgent walletId={roster.root.id} groups={groups.map((g) => ({ id: g.id, name: g.name }))} />
          ) : (
            <Link href="/login" data-tour="roster-add" className="g-btn g-btn-primary">Log in to add agents</Link>
          )}
        </div>
      </header>

      <section className="home-section" aria-labelledby="home-waiting">
        <div className="home-section-head">
          <h2 id="home-waiting" className="home-h2">
            Waiting for you
            {roster.pendingTotal > 0 && <span>{roster.pendingTotal}</span>}
          </h2>
          {roster.pendingTotal > 0 && (
            <Link href="/dashboard/approvals" className="home-link">
              {roster.pendingTotal > waiting.length ? `See all ${roster.pendingTotal}` : "Open approvals"}
            </Link>
          )}
        </div>
        {waiting.length === 0 ? (
          <p className="wait-none">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m5 12.5 4.5 4.5L19 7.5" />
            </svg>
            Nothing is waiting. Requests that need a person will show up here.
          </p>
        ) : (
          <ul className="wait g-glass">
            {waiting.map((item) => (
              <li key={item.id} className="wait-item">
                <div style={{ minWidth: 0 }}>
                  <p className="wait-what">
                    <span className="wait-dot" aria-hidden />
                    <span>{item.title}</span>
                  </p>
                  <p className="wait-who">
                    Asked by {item.agentName}
                    {item.groupName !== view.name ? ` in ${item.groupName}` : ""}, {ago(item.createdAt, now).toLowerCase()}
                  </p>
                </div>
                <Link href={`/dashboard/approvals?review=${encodeURIComponent(item.id)}`} className="g-btn g-btn-primary g-btn-sm">
                  Review
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Unfinished setup is the next thing to do, so it sits above the agents.
          Finished setup is reference, so it goes to the bottom. A waiting
          request always outranks both. */}
      {setup && !setupComplete && <div className="home-section">{setup}</div>}

      <HomeAgents groups={groups} total={roster.agentCount} />

      {setup && setupComplete && <div className="home-section">{setup}</div>}
    </div>
  )
}
