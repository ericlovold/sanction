"use client"

import { useId, useState } from "react"
import type { DailyUsage } from "./daily-usage"

function Metrics({ usage }: { usage: Pick<DailyUsage, "items" | "tokens" | "cached" | "partial" | "cachedPartial"> }) {
  const { items, tokens, cached, partial } = usage
  const suffix = partial ? " (partial)" : ""
  const share = tokens !== null && tokens > BigInt(0) && cached !== null ? (Number(cached) / Number(tokens) * 100).toFixed(1) + "%" : null
  return <>
    <td className="p-3 text-right">{items.toLocaleString("en-US")}</td>
    <td className="p-3 text-right">{tokens === null ? "Unavailable" : tokens.toLocaleString("en-US") + suffix}</td>
    <td className="p-3 text-right">{cached === null ? "Unavailable" : cached.toLocaleString("en-US") + (usage.cachedPartial ? " (partial)" : "")}</td>
    <td className="p-3 text-right">{share === null ? "Unavailable" : share + suffix}</td>
  </>
}

function DayRows({ day }: { day: DailyUsage }) {
  const [expanded, setExpanded] = useState(false)
  const id = useId()
  return <>
    <tbody className="border-t"><tr>
      <th className="p-3 text-left" scope="row">
        <button type="button" aria-expanded={expanded} aria-controls={id}
          aria-label={`${expanded ? "Hide" : "Show"} models for ${day.day}`}
          className="cursor-pointer whitespace-nowrap underline underline-offset-4" onClick={() => setExpanded(!expanded)}>
          <span aria-hidden="true" className={`mr-2 inline-block h-2 w-2 border-r border-t ${expanded ? "rotate-[135deg]" : "rotate-45"}`} />
          {day.day}
        </button>
      </th>
      <Metrics usage={day} />
    </tr></tbody>
    <tbody id={id} hidden={!expanded} className="bg-muted/30">
      {day.models.map(model => <tr key={JSON.stringify(model.model)} className="border-t">
        <th className="py-2 pl-7 pr-3 text-left font-normal" scope="row">{model.model ?? "Model unreported"}</th>
        <Metrics usage={model} />
      </tr>)}
    </tbody>
  </>
}

export function DailyTable({ days }: { days: DailyUsage[] }) {
  return <section className="space-y-3">
    <h2 className="text-xl font-medium">Usage by day and model</h2>
    <p className="text-sm text-muted-foreground">Select a UTC day to see its models. Cached share divides cached prompt tokens by all reported prompt, completion, cached prompt and cache-write tokens. Partial totals include only reported counts.</p>
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm tabular-nums">
        <thead><tr>
          <th className="p-3 text-left" scope="col">Day (UTC) / model</th>
          {["Items", "Reported tokens", "Cached prompt tokens", "Cached share"].map(label => <th key={label} className="p-3 text-right" scope="col">{label}</th>)}
        </tr></thead>
        {days.map(day => <DayRows key={day.day} day={day} />)}
      </table>
    </div>
  </section>
}
