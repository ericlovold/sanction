import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { fmtUsd } from "@/lib/format"

type Day = { label: string; cost: number }
type AgentRow = { id: string; name: string; isActive: boolean; lastUsedAt: Date | null; spend: number; decisions: number }
type ActivityRow = {
  id: string
  kind: "decision" | "model"
  title: string
  detail: string
  status: string
  amount: number
  createdAt: Date
}

type Props = {
  walletName: string
  days: Day[]
  agents: AgentRow[]
  activity: ActivityRow[]
  tokenCost: number
  approvedSpend: number
  decisions: number
  denied: number
  escalated: number
  outcomes: number
  pending: number
  activeAgents: number
  totalAgents: number
  todayTokenCost: number
  dailyTokenBudget: number
}

function Metric({ label, value, note, href }: { label: string; value: string; note: string; href?: string }) {
  const content = (
    <Card className="h-full border-border bg-card transition-colors hover:border-primary/25">
      <CardHeader className="px-4 pb-1 pt-4 sm:px-5 sm:pt-5">
        <CardTitle className="text-xs font-normal text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 sm:px-5 sm:pb-5">
        <p className="font-mono text-2xl font-semibold tracking-tight sm:text-3xl">{value}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{note}</p>
      </CardContent>
    </Card>
  )
  return href ? <Link href={href} className="block min-h-11 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{content}</Link> : content
}

function TrendChart({ days }: { days: Day[] }) {
  const max = Math.max(...days.map(day => day.cost), 0)
  return (
    <Card className="border-border bg-card">
      <CardHeader className="px-5 pb-1 pt-5">
        <CardTitle className="text-sm font-medium">AI model spend · last 14 days</CardTitle>
        <p className="text-xs text-muted-foreground">Recorded gateway usage, by day</p>
      </CardHeader>
      <CardContent className="px-5 pb-5 pt-4">
        <div className="flex h-36 items-end gap-1.5 sm:gap-2" role="img" aria-label={`AI model spend over the last 14 days. Total ${fmtUsd(days.reduce((sum, day) => sum + day.cost, 0))}.`}>
          {days.map((day, index) => {
            const height = max > 0 ? Math.max(day.cost > 0 ? 5 : 1, (day.cost / max) * 100) : 1
            return (
              <div key={`${day.label}-${index}`} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end">
                <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md group-hover:block group-focus-within:block">
                  {day.label} · {fmtUsd(day.cost)}
                </span>
                <div className="w-full rounded-t-sm bg-primary/75 transition-colors group-hover:bg-primary" style={{ height: `${height}%` }} />
                {index % 3 === 0 || index === days.length - 1 ? <span className="mt-2 text-center text-[10px] text-muted-foreground">{day.label}</span> : <span aria-hidden className="mt-2 text-center text-[10px]">&nbsp;</span>}
              </div>
            )
          })}
        </div>
        {max === 0 && <p className="mt-3 text-xs text-muted-foreground">No model usage recorded in this period.</p>}
      </CardContent>
    </Card>
  )
}

function ActivityFeed({ activity }: { activity: ActivityRow[] }) {
  return (
    <Card className="border-border bg-card">
      <CardHeader className="flex-row items-center justify-between gap-3 px-5 pb-3 pt-5">
        <div>
          <CardTitle className="text-sm font-medium">Recent activity</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">Decisions and metered model calls</p>
        </div>
        <Link href="/dashboard/audit" className="inline-flex min-h-11 items-center text-xs font-medium text-primary underline-offset-4 hover:underline">Full audit</Link>
      </CardHeader>
      <CardContent className="px-5 pb-4">
        {activity.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">No governed activity yet. Connect an agent to see decisions and model usage here.</p>
        ) : (
          <ul className="divide-y divide-border/70">
            {activity.map(item => (
              <li key={`${item.kind}-${item.id}`} className="flex min-w-0 items-start justify-between gap-3 py-3 first:pt-0 last:pb-1">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{item.title}</p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{item.detail} · {item.createdAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono text-xs">{item.amount > 0 ? fmtUsd(item.amount) : "—"}</p>
                  <p className={`mt-1 text-[11px] capitalize ${item.status === "denied" ? "text-destructive" : item.status === "escalated" || item.status === "pending" ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`}>{item.status}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function AgentTable({ agents }: { agents: AgentRow[] }) {
  return (
    <Card className="border-border bg-card">
      <CardHeader className="flex-row items-center justify-between gap-3 px-5 pb-3 pt-5">
        <div>
          <CardTitle className="text-sm font-medium">Agent fleet</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">Activity, recorded model cost, and decisions this month</p>
        </div>
        <Link href="/dashboard/agents" className="inline-flex min-h-11 shrink-0 items-center text-xs font-medium text-primary underline-offset-4 hover:underline">View agents</Link>
      </CardHeader>
      <CardContent className="px-5 pb-4">
        {agents.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">No agents in this wallet yet.</p>
        ) : (
          <ul className="divide-y divide-border/70">
            {agents.map(agent => (
              <li key={agent.id} className="flex min-w-0 items-center justify-between gap-3 py-3 first:pt-0 last:pb-1">
                <div className="flex min-w-0 items-center gap-3">
                  <span aria-hidden className={`size-2 shrink-0 rounded-full ${agent.isActive ? "bg-emerald-600 dark:bg-emerald-400" : "bg-muted-foreground/40"}`} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{agent.name}</p>
                    <p className="text-xs text-muted-foreground">{agent.isActive ? "Enabled" : "Paused"} · {agent.lastUsedAt ? `last seen ${agent.lastUsedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "not used yet"}</p>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono text-sm">{fmtUsd(agent.spend)}</p>
                  <p className="text-[11px] text-muted-foreground">{agent.decisions.toLocaleString()} decisions</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

export function ObservabilityDashboard(props: Props) {
  const budgetPercent = props.dailyTokenBudget > 0 ? Math.min(100, Math.round(props.todayTokenCost / props.dailyTokenBudget * 100)) : null
  const monthLabel = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(new Date())

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-7 sm:px-6 sm:py-9 lg:px-9">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Operations × economics</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">The agent picture</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">One view for what your agents are doing, what they cost, and what policy allowed. {props.walletName} · {monthLabel} to date.</p>
        </div>
        <Link href="/dashboard/approvals" className="inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground shadow-sm hover:opacity-90 sm:self-auto">
          {props.pending > 0 ? `${props.pending} approvals waiting` : "Review approvals"}
        </Link>
      </header>

      <section aria-label="At a glance" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Metric label="AI model cost" value={fmtUsd(props.tokenCost)} note={`${monthLabel} · gateway-recorded`} href="/dashboard/spend" />
        <Metric label="Authorized spend" value={fmtUsd(props.approvedSpend)} note="Approved requests this month" href="/dashboard/spend" />
        <Metric label="Policy decisions" value={props.decisions.toLocaleString()} note={`${props.denied} denied · ${props.escalated} escalated`} href="/dashboard/audit" />
        <Metric label="Agents enabled" value={`${props.activeAgents} / ${props.totalAgents}`} note="Fleet currently enabled" href="/dashboard/agents" />
        <Metric label="Reported outcomes" value={props.outcomes.toLocaleString()} note="Reported by your systems" href="/dashboard/spend#outcomes" />
        <Metric label="Needs a human" value={props.pending.toLocaleString()} note="Pending approval requests" href="/dashboard/approvals" />
      </section>

      <section aria-label="Budget pulse" className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,1fr)]">
        <Card className="border-border bg-card">
          <CardHeader className="px-5 pb-1 pt-5">
            <CardTitle className="text-sm font-medium">Today’s token budget</CardTitle>
            <p className="text-xs text-muted-foreground">Spend admitted through Sanction’s model gateway</p>
          </CardHeader>
          <CardContent className="px-5 pb-5 pt-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-mono text-2xl font-semibold">{fmtUsd(props.todayTokenCost)} <span className="text-sm font-normal text-muted-foreground">today</span></p>
              <p className="font-mono text-sm text-muted-foreground">{props.dailyTokenBudget > 0 ? `of ${fmtUsd(props.dailyTokenBudget)} daily cap` : "No daily cap configured"}</p>
            </div>
            {budgetPercent !== null ? <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Daily token budget used" aria-valuenow={budgetPercent} aria-valuemin={0} aria-valuemax={100}><div className={`h-full rounded-full ${budgetPercent >= 90 ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${budgetPercent}%` }} /></div> : <div className="mt-4 h-2 rounded-full bg-muted" />}
            <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>{budgetPercent === null ? "Budget usage not available" : `${budgetPercent}% of daily cap used`}</span><Link href="/dashboard/policy" className="inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline">Manage policy</Link></div>
          </CardContent>
        </Card>
        <Card className="border-border bg-card">
          <CardHeader className="px-5 pb-1 pt-5">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-sm font-medium">Vercel deployments</CardTitle>
              <span className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground">Not connected</span>
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-5 pt-2">
            <p className="text-sm leading-6 text-muted-foreground">Deployment context is not available in this workspace yet. Connect a Vercel project to correlate releases with agent spend, decisions, and outcomes.</p>
            <p className="mt-3 text-xs text-muted-foreground">No deployment status or release data is being inferred.</p>
          </CardContent>
        </Card>
      </section>

      <section aria-label="Spend and activity trends" className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <TrendChart days={props.days} />
        <ActivityFeed activity={props.activity} />
      </section>

      <AgentTable agents={props.agents} />

      <footer className="rounded-xl border border-border/70 bg-card/70 px-4 py-3 text-xs leading-5 text-muted-foreground sm:px-5">
        <span className="font-medium text-foreground">Reading this dashboard:</span> model cost reflects calls routed through Sanction’s gateway; authorized spend reflects approved requests; outcomes are reported by your systems. These measures are separate and are not added together as a single financial total.
      </footer>
    </div>
  )
}
