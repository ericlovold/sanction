import { TriangleAlert, OctagonX, CircleCheck } from "lucide-react"
import type { Pace } from "@/lib/burn"

// Utilization meter — the dashboard's core encoding for "% of budget".
// Status semantics (never color alone — each state carries icon + words):
//   < 80%   on track        (emerald)
//   80–99%  warning line    (amber; ALERT_THRESHOLD_PCT is the 80 tick on the track)
//   >= 100% exhausted       (red)
// Pace ("on pace to exhaust by 9:40 PM") comes from lib/burn dailyPace and is
// rendered as text, secondary ink. The bar is thin, rounded at the data end,
// on a muted track, with a notch at the 80% line. Uncapped budgets render as
// plain spend text — a meter with no cap is a lie.
export type MeterProps = {
  label: string
  spentUsd: number
  capUsd: number | null
  pace?: Pace | null
  sublabel?: string | null
}

function usd(n: number) {
  return n >= 100 ? `$${Math.round(n).toLocaleString()}` : `$${n.toFixed(2)}`
}

function fmtTime(d: Date) {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}

export function BudgetMeter({ label, spentUsd, capUsd, pace, sublabel }: MeterProps) {
  if (capUsd === null || capUsd <= 0) {
    return (
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-xs text-zinc-500">{label}</p>
          <p className="font-mono text-sm text-zinc-300">{usd(spentUsd)}</p>
        </div>
        <p className="mt-1 text-[11px] text-zinc-600">no cap set{sublabel ? ` · ${sublabel}` : ""}</p>
      </div>
    )
  }

  const pct = (spentUsd / capUsd) * 100
  const shown = Math.min(100, pct)
  const state = pct >= 100 ? "exhausted" : pct >= 80 ? "warning" : "ok"
  const fill = state === "exhausted" ? "bg-red-500" : state === "warning" ? "bg-amber-400" : "bg-emerald-500"
  const pctInk = state === "exhausted" ? "text-red-400" : state === "warning" ? "text-amber-300" : "text-zinc-200"

  const statusLine =
    state === "exhausted" ? (
      <span className="inline-flex items-center gap-1 text-red-400">
        <OctagonX className="size-3" aria-hidden />
        budget exhausted — further requests deny
      </span>
    ) : pace?.willExhaust && pace.exhaustAt ? (
      <span className="inline-flex items-center gap-1 text-amber-300">
        <TriangleAlert className="size-3" aria-hidden />
        on pace to exhaust by {fmtTime(pace.exhaustAt)}
      </span>
    ) : state === "warning" ? (
      <span className="inline-flex items-center gap-1 text-amber-300">
        <TriangleAlert className="size-3" aria-hidden />
        past the 80% alert line
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 text-zinc-600">
        <CircleCheck className="size-3" aria-hidden />
        on track{pace?.onPace ? ` · ~${usd(pace.onPace)} by end of day` : ""}
      </span>
    )

  return (
    <div title={`${usd(spentUsd)} of ${usd(capUsd)} (${Math.floor(pct)}%)`}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="truncate text-xs text-zinc-500">
          {label}
          {sublabel ? <span className="text-zinc-700"> · {sublabel}</span> : null}
        </p>
        <p className="shrink-0 font-mono text-sm">
          <span className={`font-semibold ${pctInk}`}>{Math.floor(pct)}%</span>
          <span className="text-zinc-600"> · {usd(spentUsd)} / {usd(capUsd)}</span>
        </p>
      </div>
      <div className="relative mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-800/70">
        <div className={`absolute inset-y-0 left-0 rounded-full ${fill}`} style={{ width: `${shown}%` }} />
        {/* the 80% alert line, as a notch on the track */}
        <div className="absolute inset-y-0 w-px bg-zinc-600" style={{ left: "80%" }} aria-hidden />
      </div>
      <p className="mt-1 text-[11px]">{statusLine}</p>
    </div>
  )
}
