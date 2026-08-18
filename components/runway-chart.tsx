import { cumulative, monthlyPace } from "@/lib/burn"
import { fmtUsd } from "@/lib/format"

// Month runway drawn, not just numbered: cumulative burn day by day, the
// monthly cap as a line, and the linear projection to month end — so "budget
// hit ~Aug 24" is visible before it's news. Pure SVG, no chart library.

const W = 100
const H = 36
const PAD_TOP = 3

export function RunwayChart({
  label,
  dailyTotals,
  capUsd,
  now,
}: {
  label: string
  /** Per-day totals (dollars) for this calendar month, index 0 = the 1st. */
  dailyTotals: number[]
  capUsd: number | null
  now: Date
}) {
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const dayOfMonth = now.getDate()
  const cum = cumulative(dailyTotals.slice(0, dayOfMonth))
  const spent = cum[cum.length - 1] ?? 0
  const pace = monthlyPace(spent, capUsd, now)

  const projectedEnd = pace.onPace ?? spent
  const maxY = Math.max(capUsd ?? 0, projectedEnd, spent, 0.01) * 1.08
  const x = (day: number) => (day / (daysInMonth - 1)) * W
  const y = (v: number) => H - ((v / maxY) * (H - PAD_TOP))

  const actualPoints = cum.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ")
  const capY = capUsd && capUsd > 0 ? y(capUsd) : null
  const exhausting = pace.willExhaust || (capUsd != null && capUsd > 0 && spent >= capUsd)

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="font-mono text-xs text-muted-foreground">
          {fmtUsd(spent)}
          {capUsd != null && capUsd > 0 ? ` / ${fmtUsd(capUsd)}` : " · no monthly cap"}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="mt-2 h-24 w-full" role="img" aria-label={`${label}: ${fmtUsd(spent)} spent this month`}>
        {capY != null && (
          <line x1="0" y1={capY} x2={W} y2={capY} className="stroke-red-400/50" strokeWidth="0.6" strokeDasharray="1.5 1.5" vectorEffect="non-scaling-stroke" />
        )}
        {pace.onPace !== null && (
          <line
            x1={x(dayOfMonth - 1)} y1={y(spent)} x2={W} y2={y(projectedEnd)}
            className={exhausting ? "stroke-amber-400/70" : "stroke-muted-foreground/40"}
            strokeWidth="0.8" strokeDasharray="2 2" vectorEffect="non-scaling-stroke"
          />
        )}
        {cum.length > 1 && (
          <polyline points={actualPoints} fill="none" className="stroke-emerald-500" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
        )}
        {cum.length > 0 && <circle cx={x(dayOfMonth - 1)} cy={y(spent)} r="1.4" className="fill-emerald-400" />}
      </svg>
      {spent <= 0 ? (
        <p className="mt-1 text-[11px] text-muted-foreground">No activity yet this month</p>
      ) : capUsd != null && capUsd > 0 && spent >= capUsd ? (
        <p className="mt-1 text-[11px] text-red-400">Monthly budget exhausted — new requests are being denied.</p>
      ) : pace.onPace !== null ? (
        <p className={`mt-1 text-[11px] ${pace.willExhaust ? "text-amber-400" : "text-muted-foreground"}`}>
          on pace for {fmtUsd(pace.onPace)} this month
          {pace.exhaustAt &&
            ` · budget hit ~${pace.exhaustAt.toLocaleDateString([], { month: "short", day: "numeric" })}`}
        </p>
      ) : (
        <p className="mt-1 text-[11px] text-muted-foreground">Too early in the month to project</p>
      )}
    </div>
  )
}
