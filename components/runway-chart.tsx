import { cumulative, monthlyPace } from "@/lib/burn"
import { fmtUsd } from "@/lib/format"

// The month so far, drawn: the running total day by day and a straight-line
// projection to the end of the month. Pure SVG plus HTML overlays, no chart
// library. Rendered on the server, so every date string uses the server's
// zone and nothing can differ at hydration.
//
// `capUsd` draws a limit line. Pass it only for a limit that really applies to
// the total being drawn: a policy's monthly limits are per agent, so a total
// for several agents has no such line.

const W = 100
const H = 40
const PAD_TOP = 4

export function RunwayChart({
  label,
  dailyTotals,
  capUsd = null,
  now,
}: {
  label: string
  /** Per-day totals (dollars) for this calendar month, index 0 = the 1st. */
  dailyTotals: number[]
  capUsd?: number | null
  now: Date
}) {
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const dayOfMonth = now.getDate()
  const days = dailyTotals.slice(0, dayOfMonth)
  const cum = cumulative(days)
  const spent = cum[cum.length - 1] ?? 0
  const cap = capUsd != null && capUsd > 0 ? capUsd : null
  const pace = monthlyPace(spent, cap, now)
  const month = now.toLocaleDateString("en-US", { month: "short" })

  const projectedEnd = pace.onPace ?? spent
  const maxY = Math.max(cap ?? 0, projectedEnd, spent, 0.01) * 1.1
  // Each day owns an equal column; its point sits at the column's center so
  // the hover columns laid over the plot line up with the line.
  const x = (index: number) => ((index + 0.5) / daysInMonth) * W
  const y = (value: number) => H - (value / maxY) * (H - PAD_TOP)
  const last = cum.length - 1

  const points = cum.map((value, i) => `${x(i).toFixed(2)},${y(value).toFixed(2)}`)
  const area = cum.length > 1 ? `${x(0).toFixed(2)},${H} ${points.join(" ")} ${x(last).toFixed(2)},${H}` : null
  const atCap = cap !== null && spent >= cap

  return (
    <figure className="sp-run">
      <figcaption className="sp-run-head">
        <span className="sp-run-label">{label}</span>
        <span className="sp-run-val">
          <b>{fmtUsd(spent)}</b> so far{cap !== null ? ` of ${fmtUsd(cap)}` : ""}
        </span>
      </figcaption>

      <div className="sp-plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${label}: ${fmtUsd(spent)} so far in ${month}`}
        >
          {cap !== null && <line x1="0" y1={y(cap)} x2={W} y2={y(cap)} className="sp-line-cap" vectorEffect="non-scaling-stroke" />}
          {area && <polygon points={area} className="sp-area" />}
          {pace.onPace !== null && last >= 0 && (
            <line
              x1={x(last)} y1={y(spent)} x2={W} y2={y(projectedEnd)}
              className="sp-line-pace" vectorEffect="non-scaling-stroke"
            />
          )}
          {cum.length > 1 && <polyline points={points.join(" ")} className="sp-line" vectorEffect="non-scaling-stroke" />}
        </svg>
        {cap !== null && <span className="sp-cap-tag" style={{ top: `${(y(cap) / H) * 100}%` }}>limit</span>}
        {last >= 0 && spent > 0 && (
          <span className="sp-dot" style={{ left: `${x(last)}%`, top: `${(y(spent) / H) * 100}%` }} aria-hidden />
        )}
        {/* One column per day that has happened: hover shows that day. */}
        <div className="sp-hits" aria-hidden>
          {Array.from({ length: daysInMonth }, (_, i) =>
            i <= last ? (
              <span key={i} className={`sp-hit${i > daysInMonth / 2 ? " sp-hit-r" : ""}`}>
                <span className="sp-tip">
                  <b>{month} {i + 1}</b>
                  {fmtUsd(cum[i])} so far
                  <span>{fmtUsd(days[i] ?? 0)} that day</span>
                </span>
              </span>
            ) : (
              <span key={i} />
            ),
          )}
        </div>
      </div>
      <div className="sp-axis" aria-hidden>
        <span>{month} 1</span>
        <span>{month} {Math.ceil(daysInMonth / 2)}</span>
        <span>{month} {daysInMonth}</span>
      </div>

      <details className="sp-run-data">
        <summary>View daily values for {label.toLowerCase()}</summary>
        <table>
          <caption>{label} in {month}: recorded daily and cumulative totals</caption>
          <thead><tr><th scope="col">Day</th><th scope="col">That day</th><th scope="col">So far</th></tr></thead>
          <tbody>
            {days.map((value, i) => (
              <tr key={i}><th scope="row">{month} {i + 1}</th><td>{fmtUsd(value)}</td><td>{fmtUsd(cum[i])}</td></tr>
            ))}
          </tbody>
        </table>
      </details>

      <p className={`sp-run-note${atCap || pace.willExhaust ? " sp-run-warn" : ""}`}>
        {spent <= 0
          ? "Nothing yet this month."
          : atCap
            ? "At the monthly limit. New requests are refused until next month."
            : pace.onPace === null
              ? "Too early in the month to project."
              : pace.exhaustAt
                ? `At this pace the limit is reached around ${pace.exhaustAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}.`
                : `At this pace, about ${fmtUsd(pace.onPace)} by the end of ${month}.`}
      </p>
    </figure>
  )
}
