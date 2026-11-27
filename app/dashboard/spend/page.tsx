import { redirect } from "next/navigation"
import type { Metadata } from "next"
import Link from "next/link"
import type { ReactNode } from "react"
import { spendReturnPath } from "@/lib/returnPath"
import { switchWalletAction } from "@/app/dashboard/actions"
import { db } from "@/lib/db"
import { inheritedTokenDefaults, walletAncestorChain } from "@/lib/cascadeBudget"
import { NoWallet } from "@/components/no-wallet"
import { getViewWallet, listViewWallets } from "@/lib/session"
import { OutcomesSection } from "@/components/outcomes-section"
import { readSpendChartDays } from "@/lib/spendChartDays"
import { subtreeWalletIds } from "@/lib/walletSubtree"
import { fmtUsd, fmtCount } from "@/lib/format"
import { RunwayChart } from "@/components/runway-chart"
import { SpendBreakdown, type BreakdownTab } from "@/components/spend-breakdown"
import { decisionsThisMonth } from "@/lib/decisionMeter"
import { seatHealth, type SeatHealthInput } from "@/lib/seatHealth"
import { decisionCode } from "@/lib/decisions"
import { closestToLimit, countAgentsAtLimit, denialReason, meter, paceNote, shares, zoneLabel } from "@/lib/spendView"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Sanction — Spend",
  description: "What your agents cost on models and purchases, and how close each is to its limits.",
}

// The list of agents near a limit stops here; the rest are counted.
const LIMIT_ROWS = 8

// A limit and how much of it is used. The fill carries the state (within,
// close, at the limit) and the sentence under it says the same in words.
function Meter({ label, spent, limit, note }: { label: ReactNode; spent: number; limit: number; note?: ReactNode }) {
  const m = meter(spent, limit)
  return (
    <div className="sp-meter" data-state={m.state}>
      <div className="sp-meter-top">
        <span className="sp-meter-label">{label}</span>
        <span className="sp-meter-val">
          <b>{fmtUsd(spent)}</b> of {fmtUsd(limit)}
        </span>
      </div>
      <div className="sp-track" role="img" aria-label={`${m.pct}% of the limit used`}>
        <span style={{ width: `${m.fill}%` }} />
      </div>
      {note && <p className="sp-meter-note">{note}</p>}
    </div>
  )
}

async function getSpend(walletId: string, now: Date) {
  const dayStart = new Date(now)
  dayStart.setHours(0, 0, 0, 0)
  const monthStart = new Date(dayStart)
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  // Totals roll up the wallet and every group below it.
  const { ids: walletIds } = await subtreeWalletIds(walletId)
  const [wallet, agents] = await Promise.all([
    db.wallet.findUnique({ where: { id: walletId }, include: { policy: true } }),
    db.agent.findMany({
      where: { walletId: { in: walletIds } },
      select: {
        id: true, name: true, dailyTokenBudgetUsd: true, dailySpendBudgetUsd: true, perTransactionMaxUsd: true, escalateOverUsd: true,
        // Each agent is measured against its own wallet's defaults, not the
        // wallet being viewed: a group below can set different limits.
        wallet: { select: { id: true, name: true, policy: { select: { dailyTokenBudgetUsd: true, dailySpendBudgetUsd: true } } } },
      },
    }),
  ])
  // Resolve each wallet once, including a policyless view root whose default
  // may come from outside the visible subtree. Only the numeric limit leaves
  // this lookup; ancestor names and unrelated agents never enter the view.
  const policies = new Map(agents.map((a) => [a.wallet.id, a.wallet.policy]))
  policies.set(walletId, wallet?.policy ?? null)
  const modelDefaults = new Map(await Promise.all([...policies].map(async ([id, policy]) => [
    id,
    policy?.dailyTokenBudgetUsd ?? inheritedTokenDefaults(await walletAncestorChain(db, id))?.dailyTokenBudgetUsd ?? null,
  ] as const)))
  const agentIds = agents.map((a) => a.id)
  const nameOf = new Map(agents.map((a) => [a.id, a.name]))
  const overrideOf = new Map(
    agents.map((a) => {
      const parts: string[] = []
      if (a.dailyTokenBudgetUsd != null) parts.push(`models ${fmtUsd(a.dailyTokenBudgetUsd / 100)} a day`)
      if (a.dailySpendBudgetUsd != null) parts.push(`purchases ${fmtUsd(a.dailySpendBudgetUsd / 100)} a day`)
      if (a.perTransactionMaxUsd != null) parts.push(`largest purchase ${fmtUsd(a.perTransactionMaxUsd / 100)}`)
      if (a.escalateOverUsd != null) parts.push(`asks a person above ${fmtUsd(a.escalateOverUsd / 100)}`)
      return [a.id, parts.join(", ")]
    }),
  )

  const monthScope = { agentId: { in: agentIds }, createdAt: { gte: monthStart } }
  const todayScope = { agentId: { in: agentIds }, createdAt: { gte: dayStart } }

  const weekStart = new Date(now)
  weekStart.setDate(weekStart.getDate() - 6)
  weekStart.setHours(0, 0, 0, 0)

  const [
    tokDay, spendDay, tokMonth, spendMonth,
    byModel, byTask, tokByAgent, authByAgent, byCategory, decisionMix,
    chartDays, authByAgentRecent, deniedNotes, tokTodayByAgent, spendTodayByAgent,
  ] = await Promise.all([
    db.tokenLog.aggregate({ where: todayScope, _sum: { costUsd: true, tokensIn: true, tokensOut: true } }),
    db.authorizationRequest.aggregate({ where: { ...todayScope, status: "approved" }, _sum: { amountUsd: true } }),
    db.tokenLog.aggregate({ where: monthScope, _sum: { costUsd: true, tokensIn: true, tokensOut: true }, _count: { _all: true } }),
    db.authorizationRequest.aggregate({ where: { ...monthScope, status: "approved" }, _sum: { amountUsd: true } }),
    db.tokenLog.groupBy({ by: ["model"], where: monthScope, _sum: { costUsd: true, tokensIn: true, tokensOut: true }, _count: { _all: true }, orderBy: { _sum: { costUsd: "desc" } } }),
    db.tokenLog.groupBy({ by: ["taskLabel"], where: monthScope, _sum: { costUsd: true }, _count: { _all: true }, orderBy: { _sum: { costUsd: "desc" } } }),
    db.tokenLog.groupBy({ by: ["agentId"], where: monthScope, _sum: { costUsd: true, tokensIn: true, tokensOut: true } }),
    db.authorizationRequest.groupBy({ by: ["agentId", "status"], where: monthScope, _sum: { amountUsd: true }, _count: true }),
    db.authorizationRequest.groupBy({ by: ["category"], where: { ...monthScope, status: "approved" }, _sum: { amountUsd: true }, _count: true, orderBy: { _sum: { amountUsd: "desc" } } }),
    db.authorizationRequest.groupBy({ by: ["status"], where: monthScope, _count: true }),
    readSpendChartDays(walletIds, agentIds, dayStart),
    db.authorizationRequest.groupBy({ by: ["agentId", "status"], where: { agentId: { in: agentIds }, createdAt: { gte: weekStart } }, _count: true }),
    db.authorizationRequest.groupBy({ by: ["agentId", "decisionNote"], where: { ...monthScope, status: "denied" }, _count: true }),
    db.tokenLog.groupBy({ by: ["agentId"], where: todayScope, _sum: { costUsd: true } }),
    db.authorizationRequest.groupBy({ by: ["agentId"], where: { ...todayScope, status: "approved" }, _sum: { amountUsd: true } }),
  ])

  // Model defaults come from the nearest policy, even outside this view.
  // Agent overrides win; an absent default stays unlimited rather than zero.
  const today = new Map<string, { model: number; purchases: number }>()
  for (const id of agentIds) today.set(id, { model: 0, purchases: 0 })
  for (const r of tokTodayByAgent) {
    const row = today.get(r.agentId)
    if (row) row.model = r._sum.costUsd ?? 0
  }
  for (const r of spendTodayByAgent) {
    const row = today.get(r.agentId)
    if (row) row.purchases = r._sum.amountUsd ?? 0
  }
  const limitRows = closestToLimit(
    agents.map((a) => ({
      id: a.id,
      name: a.name,
      modelLimitCents: a.dailyTokenBudgetUsd ?? modelDefaults.get(a.wallet.id) ?? null,
      purchaseLimitCents: a.dailySpendBudgetUsd ?? a.wallet?.policy?.dailySpendBudgetUsd ?? null,
    })),
    today,
  )

  // Purchases still require a local policy; model defaults may be inherited.
  const unruled = [...new Map(
    agents.filter((a) => a.wallet && !a.wallet.policy && a.wallet.id !== walletId).map((a) => [a.wallet.id, a.wallet.name]),
  ).values()].sort()

  // Per-agent merge: model cost + approved purchases + decision counts
  const agentRows = new Map<string, { id: string; name: string; override: string; tokenCost: number; tokens: number; spend: number; approved: number; denied: number; escalated: number }>()
  for (const id of agentIds) agentRows.set(id, { id, name: nameOf.get(id) ?? id, override: overrideOf.get(id) ?? "", tokenCost: 0, tokens: 0, spend: 0, approved: 0, denied: 0, escalated: 0 })
  for (const r of tokByAgent) {
    const row = agentRows.get(r.agentId)
    if (row) { row.tokenCost = r._sum.costUsd ?? 0; row.tokens = (r._sum.tokensIn ?? 0) + (r._sum.tokensOut ?? 0) }
  }
  for (const r of authByAgent) {
    const row = agentRows.get(r.agentId)
    if (!row) continue
    if (r.status === "approved") { row.spend += r._sum.amountUsd ?? 0; row.approved += r._count }
    else if (r.status === "denied") row.denied += r._count
    else if (r.status === "escalated") row.escalated += r._count
  }
  const agentList = [...agentRows.values()].sort((a, b) => (b.tokenCost + b.spend) - (a.tokenCost + a.spend))

  const { days, tokenByMonthDay, spendByMonthDay } = chartDays

  const mix = Object.fromEntries(decisionMix.map((r) => [r.status, r._count])) as Record<string, number>

  // MONO-0: the month's fresh engine decisions, from the counter (allowed tool
  // calls never persist a row, so the row-derived mix undercounts them).
  const decisions = await decisionsThisMonth(walletIds)

  // Agents refused often: month vs last-7-days decision mix, plus each agent's
  // most-hit denial code (decisionNote → stable DecisionCode, as agents see it).
  const recentByAgent = new Map<string, { approved: number; denied: number; escalated: number }>()
  for (const r of authByAgentRecent) {
    const row = recentByAgent.get(r.agentId) ?? { approved: 0, denied: 0, escalated: 0 }
    if (r.status === "approved") row.approved += r._count
    else if (r.status === "denied") row.denied += r._count
    else if (r.status === "escalated") row.escalated += r._count
    recentByAgent.set(r.agentId, row)
  }
  const topDenialByAgent = new Map<string, { code: string; count: number }>()
  for (const r of deniedNotes) {
    const code = decisionCode("denied", r.decisionNote) ?? "POLICY_DENIED"
    const cur = topDenialByAgent.get(r.agentId)
    if (!cur || r._count > cur.count) topDenialByAgent.set(r.agentId, { code, count: r._count })
  }
  const healthInputs: SeatHealthInput[] = agentIds.map((id) => {
    const m = agentRows.get(id)
    return {
      id,
      name: nameOf.get(id) ?? id,
      month: { approved: m?.approved ?? 0, denied: m?.denied ?? 0, escalated: m?.escalated ?? 0 },
      recent: recentByAgent.get(id) ?? { approved: 0, denied: 0, escalated: 0 },
      topDenial: topDenialByAgent.get(id),
    }
  })
  const seatFlags = seatHealth(healthInputs)

  return {
    wallet, policy: wallet?.policy ?? null, modelDefaultCents: modelDefaults.get(walletId) ?? null,
    tokDay, spendDay, tokMonth, spendMonth,
    byModel, byTask: byTask.filter((t) => (t._sum.costUsd ?? 0) > 0), byCategory,
    agentList, days, mix, decisions,
    tokenByMonthDay, spendByMonthDay, seatFlags, limitRows, unruled,
  }
}

// "A", "A and B", "A, B and C", "A, B, C and 2 more".
function nameList(names: string[]) {
  const shown = names.slice(0, 3)
  const rest = names.length - shown.length
  if (rest > 0) return `${shown.join(", ")} and ${rest} more`
  if (shown.length <= 1) return shown[0] ?? ""
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`
}

function plural(n: number, one: string, many: string) {
  return `${fmtCount(n)} ${n === 1 ? one : many}`
}

export default async function SpendPage({ searchParams }: {
  searchParams: Promise<{ wallet?: string; agent?: string; budget?: string }>
}) {
  const { wallet: requestedWallet, agent: requestedAgent, budget } = await searchParams
  const view = await getViewWallet()
  const next = requestedWallet ? spendReturnPath(requestedWallet, requestedAgent, budget) : "/dashboard/spend"
  if (requestedWallet && (!view || !view.isSession)) redirect(`/login?next=${encodeURIComponent(next)}`)
  if (!view) return <NoWallet />

  let walletId = view.id
  if (requestedWallet && requestedWallet !== view.id) {
    const { ids } = await subtreeWalletIds(view.id)
    if (!ids.includes(requestedWallet)) {
      const wallets = (await listViewWallets()).filter(w => w.id !== view.id)
      return (
        <div className="home sp-page">
          <section className="g-panel sp-gate">
            <h1 className="home-h2">Switch wallets to review this budget</h1>
            <p>You’re signed in to <strong>{view.name}</strong>. This budget isn’t available from this wallet.</p>
            <p>Sign in with an account or management key that can access the wallet named in the alert. We’ll return you to its budget.</p>
            {wallets.length > 0 && (
              <form action={switchWalletAction} className="sp-gate-form">
                <input type="hidden" name="next" value={next} />
                <label>
                  Wallet
                  <select name="wallet_id" className="g-input">
                    {wallets.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </label>
                <button className="g-btn g-btn-primary">Switch wallet and return</button>
              </form>
            )}
            <Link className="home-link" href={`/login?next=${encodeURIComponent(next)}`}>Sign in to another wallet</Link>
            <Link className="home-link" href="/dashboard/spend">Back to this wallet’s spend</Link>
          </section>
        </div>
      )
    }
    walletId = requestedWallet
  }
  // Look up the alert's agent only inside the authorized target wallet.
  const alertAgent = requestedWallet && requestedAgent
    ? await db.agent.findFirst({ where: { id: requestedAgent, walletId }, select: { id: true, name: true, dailyTokenBudgetUsd: true, dailySpendBudgetUsd: true } })
    : null
  if (requestedAgent && requestedWallet && !alertAgent) {
    return (
      <div className="home sp-page">
        <section className="g-panel sp-gate">
          <h1 className="home-h2">This agent’s budget is no longer available</h1>
          <p>The linked agent was not found in this wallet.</p>
          <Link className="home-link" href={spendReturnPath(walletId)}>Review this wallet’s budget</Link>
        </section>
      </div>
    )
  }

  const now = new Date()
  const s = await getSpend(walletId, now)
  const zone = zoneLabel(now)
  const dayStart = new Date(now)
  dayStart.setHours(0, 0, 0, 0)
  const alertUsage = alertAgent ? await Promise.all([
    db.tokenLog.aggregate({ where: { agentId: alertAgent.id, createdAt: { gte: dayStart } }, _sum: { costUsd: true } }),
    db.authorizationRequest.aggregate({ where: { agentId: alertAgent.id, status: "approved", createdAt: { gte: dayStart } }, _sum: { amountUsd: true } }),
  ]) : null

  const modelDay = s.tokDay._sum.costUsd ?? 0
  const purchaseDay = s.spendDay._sum.amountUsd ?? 0
  const modelMonth = s.tokMonth._sum.costUsd ?? 0
  const purchaseMonth = s.spendMonth._sum.amountUsd ?? 0
  const tokensMonth = (s.tokMonth._sum.tokensIn ?? 0) + (s.tokMonth._sum.tokensOut ?? 0)
  const walletName = s.wallet?.name ?? view.name
  const ownWallet = walletId === view.id

  // The two caps that add every agent together. Everything else is per agent.
  const pooledPurchases = s.policy?.subtreeDailyCapUsd != null ? s.policy.subtreeDailyCapUsd / 100 : null
  const pooledModel = s.policy?.subtreeDailyTokenCapUsd != null ? s.policy.subtreeDailyTokenCapUsd / 100 : null
  const atLimit = countAgentsAtLimit(s.limitRows)
  // The counter can trail the rows it counts (it is written after the
  // response), so never show fewer decisions than there are recorded outcomes.
  const decided = Math.max(s.decisions, (s.mix.approved ?? 0) + (s.mix.denied ?? 0) + (s.mix.escalated ?? 0))

  // Where it went: four lists, one shown at a time.
  const active = s.agentList.filter((a) => a.tokens > 0 || a.approved > 0 || a.denied > 0 || a.escalated > 0 || a.spend > 0 || a.tokenCost > 0)
  const idle = s.agentList.length - active.length
  const agentShare = shares(active.map((a) => a.tokenCost + a.spend))
  const modelShare = shares(s.byModel.map((m) => m._sum.costUsd ?? 0))
  const taskShare = shares(s.byTask.map((t) => t._sum.costUsd ?? 0))
  const categoryShare = shares(s.byCategory.map((c) => c._sum.amountUsd ?? 0))
  const tabs: BreakdownTab[] = [
    {
      id: "agents",
      label: "Agents",
      rows: active.map((a, i) => ({
        key: a.id,
        label: a.name,
        sub: [
          `${fmtCount(a.tokens)} tokens`,
          a.approved > 0 ? `${fmtCount(a.approved)} approved` : "",
          a.denied > 0 ? `${fmtCount(a.denied)} refused` : "",
          a.escalated > 0 ? `${fmtCount(a.escalated)} waiting for a person` : "",
        ].filter(Boolean).join(" · "),
        amount: fmtUsd(a.tokenCost + a.spend),
        detail: a.spend > 0 ? `${fmtUsd(a.spend)} in purchases` : undefined,
        share: agentShare[i],
        href: `/dashboard/agents#seat-${a.id}`,
        chip: a.override ? `Own limits: ${a.override}` : undefined,
      })),
      empty: s.agentList.length === 0
        ? "No agents yet. Add one on the Agents page and what it costs shows here."
        : "No agent has spent anything or asked for anything this month.",
      note: idle > 0 && active.length > 0 ? `${plural(idle, "agent", "agents")} with no activity this month.` : undefined,
    },
    {
      id: "models",
      label: "Models",
      rows: s.byModel.map((m, i) => ({
        key: m.model,
        label: m.model,
        mono: true,
        sub: `${plural(m._count._all, "call", "calls")} · ${fmtCount((m._sum.tokensIn ?? 0) + (m._sum.tokensOut ?? 0))} tokens`,
        amount: fmtUsd(m._sum.costUsd ?? 0),
        share: modelShare[i],
      })),
      empty: "No model spend yet. Point an agent's model SDK at the Sanction gateway, or log tokens directly, and each model's cost shows here.",
    },
    {
      id: "tasks",
      label: "Tasks",
      rows: s.byTask.map((t, i) => ({
        key: t.taskLabel ?? "",
        label: t.taskLabel ?? "No task label",
        sub: plural(t._count._all, "call", "calls"),
        amount: fmtUsd(t._sum.costUsd ?? 0),
        share: taskShare[i],
      })),
      empty: "No labeled tasks yet. Send a task_label with token logs and model spend groups by task here.",
    },
    {
      id: "categories",
      label: "Categories",
      rows: s.byCategory.map((c, i) => ({
        key: c.category,
        label: c.category,
        sub: plural(c._count, "approved purchase", "approved purchases"),
        amount: fmtUsd(c._sum.amountUsd ?? 0),
        share: categoryShare[i],
      })),
      empty: "No approved purchases this month.",
    },
  ]

  const barMax = Math.max(...s.days.map((d) => d.cost), 0)
  const peak = s.days.reduce((best, d) => (d.cost > best.cost ? d : best), s.days[0] ?? { label: "", cost: 0 })

  return (
    <div className="home sp-page">
      <header className="home-head">
        <div>
          <h1 className="home-title">Spend &amp; budgets</h1>
          <p className="home-sub">{walletName}</p>
        </div>
        <div className="home-actions">
          {ownWallet ? (
            <Link href="/dashboard/policy" className="g-btn g-btn-quiet">Change limits</Link>
          ) : (
            <Link className="home-link" href={`/login?next=${encodeURIComponent(next)}`}>Sign in to this wallet to manage policy</Link>
          )}
        </div>
      </header>
      <p className="appr-lede">
        What your agents cost on models and on purchases, for this wallet and every group below it.
      </p>

      <p className="pol-hint">
        Recorded usage, not live available budget. Model totals come from token logs; unreported calls and
        outstanding gateway holds are not included. Purchases are approved authorization amounts, not confirmed
        payments, grouped by request creation time and including approvals whose grants have not been redeemed.
        Budget decisions also account for grant state, decision time, reservations, and observe mode.
      </p>

      {requestedWallet && (
        <section className="g-panel sp-review" aria-labelledby="sp-review">
          <h2 id="sp-review" className="home-h2">Budget review · {s.wallet?.name}</h2>
          {alertAgent && alertUsage ? (
            <>
              <p className="sp-review-who">{alertAgent.name} · today</p>
              <div className="sp-meters">
                {budget !== "daily_spend" && (() => {
                  const limitCents = alertAgent.dailyTokenBudgetUsd ?? s.modelDefaultCents
                  if (limitCents == null) return <p className="sp-review-who">No per-agent daily model limit applies.</p>
                  const limit = limitCents / 100
                  const spent = alertUsage[0]._sum.costUsd ?? 0
                  return <Meter label="Model spend" spent={spent} limit={limit} note={paceNote(spent, limit, now)} />
                })()}
                {budget !== "daily_tokens" && (() => {
                  const limitCents = alertAgent.dailySpendBudgetUsd ?? s.policy?.dailySpendBudgetUsd
                  if (limitCents == null) return <p className="sp-review-who">No per-agent daily purchase limit applies.</p>
                  const limit = limitCents / 100
                  const spent = alertUsage[1]._sum.amountUsd ?? 0
                  return <Meter label="Purchases" spent={spent} limit={limit} note={paceNote(spent, limit, now)} />
                })()}
              </div>
            </>
          ) : budget === "subtree_daily_spend" && pooledPurchases !== null ? (
            <div className="sp-meters">
              <Meter label="Purchases, all agents together" spent={purchaseDay} limit={pooledPurchases} note={paceNote(purchaseDay, pooledPurchases, now)} />
            </div>
          ) : (
            <p className="sp-review-who">Showing the wallet named in the alert. Current usage appears below.</p>
          )}
          <p className="pol-hint">Current usage may differ from the email snapshot.</p>
        </section>
      )}

      {/* The four numbers a person opens this page for. */}
      <dl className="sp-figs g-glass">
        <div>
          <dt>This month</dt>
          <dd>{fmtUsd(modelMonth + purchaseMonth)}</dd>
          <dd className="sp-fig-sub">models and purchases</dd>
        </div>
        <div>
          <dt>Model spend</dt>
          <dd>{fmtUsd(modelMonth)}</dd>
          <dd className="sp-fig-sub">{fmtCount(tokensMonth)} tokens</dd>
        </div>
        <div>
          <dt>Purchases</dt>
          <dd>{fmtUsd(purchaseMonth)}</dd>
          <dd className="sp-fig-sub">{fmtCount(s.mix.approved ?? 0)} approved</dd>
        </div>
        <div>
          <dt>Today</dt>
          <dd>{fmtUsd(modelDay + purchaseDay)}</dd>
          <dd className="sp-fig-sub">resets at midnight {zone}</dd>
        </div>
      </dl>
      <p className="sp-requests">
        {plural(decided, "request", "requests")} decided this month. {fmtCount(s.mix.denied ?? 0)} refused
        {(s.mix.escalated ?? 0) > 0 ? (
          <>
            , <Link href="/dashboard/approvals" className="home-link">{fmtCount(s.mix.escalated)} waiting for a person</Link>
          </>
        ) : null}
        .
      </p>

      <section className="home-section" aria-labelledby="sp-limits">
        <div className="home-section-head">
          <h2 id="sp-limits" className="home-h2">
            Recorded usage against daily limits{atLimit > 0 && <span>{plural(atLimit, "agent", "agents")} with recorded usage at a limit</span>}
          </h2>
        </div>
        <p className="pol-lede">
          {s.policy
            ? `Each agent has its own limit: ${fmtUsd(s.policy.dailyTokenBudgetUsd / 100)} a day on models and ${fmtUsd(s.policy.dailySpendBudgetUsd / 100)} a day on purchases in ${walletName}, unless the agent or its group sets another.`
            : `${walletName} has no policy yet, so its agents' purchases are refused. ${s.modelDefaultCents != null
              ? `Its agents inherit a default model limit of ${fmtUsd(s.modelDefaultCents / 100)} a day from the nearest policy above this wallet, unless an agent sets its own.`
              : "No per-agent daily model limit applies unless an agent sets its own."}`}{" "}
          {pooledPurchases === null && pooledModel === null && s.policy
            ? "This wallet sets no shared cap; a policy above it may still apply."
            : ""}
        </p>

        {s.unruled.length > 0 && (
          <p className="pol-warn sp-unruled">
            {nameList(s.unruled)} {s.unruled.length === 1 ? "has" : "have"} no policy of {s.unruled.length === 1 ? "its" : "their"} own.
            Purchases by agents there are refused. Model limits come from the nearest policy above each group when one
            exists, unless an agent sets its own limit.
          </p>
        )}

        {(pooledPurchases !== null || pooledModel !== null) && (
          <div className="g-panel sp-pooled">
            <p className="sp-pooled-title">Recorded usage across all agents, today</p>
            <div className="sp-meters">
              {pooledModel !== null && (
                <Meter label="Model spend" spent={modelDay} limit={pooledModel} note={paceNote(modelDay, pooledModel, now)} />
              )}
              {pooledPurchases !== null && (
                <Meter label="Purchases" spent={purchaseDay} limit={pooledPurchases} note={paceNote(purchaseDay, pooledPurchases, now)} />
              )}
            </div>
          </div>
        )}

        <div className="g-panel">
          {s.limitRows.length === 0 ? (
            <p className="g-empty">No recorded usage reaches half of an applicable daily limit today.</p>
          ) : (
            <div className="sp-limits">
              {s.limitRows.slice(0, LIMIT_ROWS).map((row) => (
                <Meter
                  key={`${row.id}-${row.kind}`}
                  label={
                    <>
                      <Link href={`/dashboard/agents#seat-${row.id}`} className="sp-limit-name">{row.name}</Link>
                      <span className="sp-limit-kind">{row.kind === "model" ? "model spend" : "purchases"}</span>
                    </>
                  }
                  spent={row.spentUsd}
                  limit={row.limitUsd}
                  note={
                    row.view.state === "at"
                      ? "Recorded usage meets this limit. This does not establish whether the next request will be refused."
                      : undefined
                  }
                />
              ))}
              {s.limitRows.length > LIMIT_ROWS && (
                <p className="sp-brk-note">And {fmtCount(s.limitRows.length - LIMIT_ROWS)} more above half of a limit.</p>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="home-section" aria-labelledby="sp-month">
        <h2 id="sp-month" className="home-h2">This month, day by day</h2>
        <div className="g-panel sp-charts">
          <RunwayChart label="Model spend" dailyTotals={s.tokenByMonthDay} now={now} />
          <RunwayChart label="Purchases" dailyTotals={s.spendByMonthDay} now={now} />
        </div>
      </section>

      <section className="home-section" aria-labelledby="sp-days">
        <h2 id="sp-days" className="home-h2">Model spend <span>last 14 days</span></h2>
        <div className="g-panel sp-days">
          <div className="sp-bars" aria-hidden>
            {s.days.map((d, i) => (
              <span key={i} className={`sp-bar-col${i > s.days.length / 2 ? " sp-hit-r" : ""}`}>
                <span className="sp-tip">
                  <b>{d.label}</b>
                  {fmtUsd(d.cost)}
                </span>
                <span className="sp-bar" style={{ height: barMax > 0 ? `${Math.max(d.cost > 0 ? 2 : 0, (d.cost / barMax) * 100)}%` : 0 }} />
              </span>
            ))}
          </div>
          <div className="sp-bar-axis" aria-hidden>
            {s.days.map((d, i) => (
              <span key={i}>{(s.days.length - 1 - i) % 2 === 0 ? d.label : ""}</span>
            ))}
          </div>
          <p className="sp-run-note">
            {barMax > 0
              ? `Highest day: ${fmtUsd(peak.cost)} on ${peak.label}. Today: ${fmtUsd(s.days[s.days.length - 1]?.cost ?? 0)}.`
              : "No model spend in the last 14 days."}
          </p>
          <details className="sp-run-data">
            <summary>Show daily values</summary>
            <table>
              <caption>Model spend per day, last 14 days</caption>
              <thead><tr><th>Day</th><th>Model spend</th></tr></thead>
              <tbody>
                {s.days.map((d, i) => <tr key={i}><td>{d.label}</td><td>{fmtUsd(d.cost)}</td></tr>)}
              </tbody>
            </table>
          </details>
        </div>
      </section>

      <SpendBreakdown tabs={tabs} />

      {/* Only when there is something to act on. */}
      {s.seatFlags.length > 0 && (
        <section className="home-section" aria-labelledby="sp-refused">
          <h2 id="sp-refused" className="home-h2">Refused often</h2>
          <p className="pol-lede">
            An agent that keeps hitting the same rule is usually set up wrong. Check its own limits, or the lists in
            Policy, first.
          </p>
          <div className="g-panel">
            {s.seatFlags.map((f) => (
              <div key={f.id} className="dec-row sp-flag">
                <div style={{ minWidth: 0 }}>
                  <p className="set-title">
                    <Link href={`/dashboard/agents#seat-${f.id}`} className="sp-limit-name">{f.name}</Link>
                    {f.climbing && <span className="dec-pill sp-pill-wait">Rising</span>}
                  </p>
                  <p className="set-body">
                    Refused {Math.round(f.denialRateMonth * 100)}% of the time this month
                    {f.climbing && `, ${Math.round(f.denialRateRecent * 100)}% in the last 7 days`}
                    {f.escalationRateMonth > 0 && `. ${Math.round(f.escalationRateMonth * 100)}% sent to a person`}.
                    {f.topDenial && ` Most often: ${denialReason(f.topDenial.code)}, ${plural(f.topDenial.count, "time", "times")}.`}
                  </p>
                </div>
                {f.topDenial && <span className="dec-grant pol-mono">{f.topDenial.code}</span>}
              </div>
            ))}
          </div>
        </section>
      )}

      <OutcomesSection rootWalletId={walletId} />
    </div>
  )
}
