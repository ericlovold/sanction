"use client"

import { useMemo, useState } from "react"
import Link from "next/link"

const findings = [
  { name: "Product", people: 18, tools: "Claude, OpenAI", spend: "$842", tone: "sage" },
  { name: "Engineering", people: 31, tools: "Cursor, OpenAI", spend: "$1,904", tone: "amber" },
  { name: "Operations", people: 12, tools: "ChatGPT", spend: "$386", tone: "blue" },
]

const steps = [
  { number: "01", title: "Connect eve", body: "Give eve a governed path into the tools your team already trusts." },
  { number: "02", title: "Scan the roster", body: "eve gathers people, teams, licenses, and observed usage into a dated snapshot." },
  { number: "03", title: "Review the plan", body: "Sanction turns that snapshot into seats, pools, budgets, and policy packs." },
]

export default function EvePage() {
  const [observe, setObserve] = useState(true)
  const [selected, setSelected] = useState<string[]>(findings.map((finding) => finding.name))
  const [copied, setCopied] = useState(false)
  const selectedSpend = useMemo(() => findings.filter((finding) => selected.includes(finding.name)).reduce((sum, finding) => sum + Number(finding.spend.replace(/[$,]/g, "")), 0), [selected])

  function copyCommand() {
    navigator.clipboard?.writeText("npx eve@latest init sanction-agent")
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  function toggleTeam(name: string) {
    setSelected((current) => current.includes(name) ? current.filter((item) => item !== name) : [...current, name])
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10 px-5 py-7 md:px-10 md:py-12">
      <header className="flex flex-col gap-6 border-b border-border pb-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl space-y-4">
          <Link href="/dashboard" className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground">← Back to roster</Link>
          <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground"><span className="size-2 rounded-full bg-primary" /> eve integration</div>
          <h1 className="font-display text-4xl font-semibold tracking-tight md:text-6xl">Let eve find your AI seats.</h1>
          <p className="max-w-xl text-base leading-7 text-muted-foreground md:text-lg">Connect eve to Sanction, scan the organization once, and turn shadow usage into a governed seat plan. Nothing is enforced until an owner says so.</p>
        </div>
        <div className="flex max-w-sm flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between"><span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">maturity path</span><span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">observe first</span></div>
          <p className="text-sm leading-6">The first scan is read-only. Watch the board fill in, then migrate one pool at a time from observe to enforce.</p>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        {steps.map((step) => <div key={step.number} className="flex gap-4 rounded-xl border border-border bg-card p-5"><span className="font-mono text-xs text-primary">{step.number}</span><div className="space-y-2"><h2 className="font-display text-lg font-semibold">{step.title}</h2><p className="text-sm leading-6 text-muted-foreground">{step.body}</p></div></div>)}
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-xl border border-border bg-card p-5 md:p-7">
          <div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between"><div><p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">sample snapshot / 2026-11-09</p><h2 className="mt-2 font-display text-2xl font-semibold">Shadow-AI findings</h2><p className="mt-1 text-sm text-muted-foreground">A normalized roster supplied by eve connectors.</p></div><span className="rounded-full border border-primary/30 px-3 py-1 text-xs font-medium text-primary">read-only</span></div>
          <div className="flex flex-col divide-y divide-border">
            {findings.map((finding) => <button key={finding.name} type="button" onClick={() => toggleTeam(finding.name)} className="flex min-h-16 items-center gap-3 py-4 text-left transition-opacity hover:opacity-80"><span className={`size-2.5 rounded-full ${finding.tone === "sage" ? "bg-primary" : finding.tone === "amber" ? "bg-amber-500" : "bg-sky-500"}`} /><span className="min-w-0 flex-1"><span className="block font-medium">{finding.name}</span><span className="block text-xs text-muted-foreground">{finding.people} people · {finding.tools}</span></span><span className="text-right"><span className="block font-mono text-sm">{finding.spend}</span><span className="block text-xs text-muted-foreground">30d observed</span></span><span aria-hidden="true" className={`ml-2 flex size-5 items-center justify-center rounded border text-xs ${selected.includes(finding.name) ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>{selected.includes(finding.name) ? "✓" : ""}</span></button>)}
          </div>
          <div className="mt-5 flex flex-col gap-3 rounded-lg bg-muted/50 p-4 text-sm sm:flex-row sm:items-center sm:justify-between"><span><strong>{selected.length} pools selected</strong><span className="text-muted-foreground"> · ${selectedSpend.toLocaleString()} observed spend</span></span><span className="font-mono text-xs text-muted-foreground">provenance: eve connectors</span></div>
        </div>

        <div className="flex flex-col gap-5 rounded-xl bg-sidebar p-5 text-sidebar-foreground md:p-7">
          <div className="flex items-center justify-between"><span className="font-mono text-[11px] uppercase tracking-[0.14em] text-sidebar-foreground/60">mode</span><button type="button" aria-pressed={observe} onClick={() => setObserve((value) => !value)} className={`relative h-7 w-12 rounded-full transition-colors ${observe ? "bg-sidebar-primary" : "bg-sidebar-foreground/25"}`}><span className={`absolute top-1 size-5 rounded-full bg-white transition-transform ${observe ? "translate-x-6" : "translate-x-1"}`} /></button></div>
          <div><h2 className="font-display text-3xl font-semibold">{observe ? "Observe before enforce." : "Enforce with intent."}</h2><p className="mt-3 text-sm leading-6 text-sidebar-foreground/70">{observe ? "Sanction computes every decision and records what would have happened, but never blocks the team." : "Sanction applies wallet and pool policy to every governed action. Escalations still come to the owner."}</p></div>
          <div className="mt-auto space-y-3 border-t border-sidebar-border pt-5"><div className="flex items-center justify-between text-xs"><span className="text-sidebar-foreground/60">next action</span><span className="font-medium">{observe ? "Preview seat plan" : "Apply policy"}</span></div><button type="button" className="min-h-11 w-full rounded-md bg-sidebar-primary px-4 py-3 text-sm font-semibold text-sidebar-primary-foreground transition-opacity hover:opacity-90">{observe ? "Preview seat plan" : "Review policy"} <span aria-hidden="true">→</span></button></div>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-xl border border-border bg-card p-5 md:p-7"><p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">install eve</p><h2 className="mt-2 font-display text-2xl font-semibold">A governed agent, not another dashboard.</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">eve owns the conversation and connectors. Sanction stays the deterministic enforcement point for identity, budgets, approvals, and audit.</p><button type="button" onClick={copyCommand} className="mt-5 flex min-h-11 w-full items-center justify-between rounded-lg border border-border bg-muted/50 px-4 text-left font-mono text-xs hover:bg-muted"><span>npx eve@latest init sanction-agent</span><span className="text-muted-foreground">{copied ? "copied" : "copy"}</span></button></div>
        <div className="rounded-xl border border-border bg-card p-5 md:p-7"><div className="flex items-center justify-between"><div><p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">what gets created</p><h2 className="mt-2 font-display text-2xl font-semibold">A plan with receipts.</h2></div><span className="font-mono text-xs text-muted-foreground">deterministic</span></div><div className="mt-6 grid gap-3 sm:grid-cols-2"><div className="rounded-lg bg-muted/50 p-4"><p className="font-medium">Pools</p><p className="mt-1 text-sm text-muted-foreground">One governed budget lane per team.</p></div><div className="rounded-lg bg-muted/50 p-4"><p className="font-medium">Seats</p><p className="mt-1 text-sm text-muted-foreground">A scoped identity for each observed user.</p></div><div className="rounded-lg bg-muted/50 p-4"><p className="font-medium">Policies</p><p className="mt-1 text-sm text-muted-foreground">Starting packs matched to team context.</p></div><div className="rounded-lg bg-muted/50 p-4"><p className="font-medium">Audit</p><p className="mt-1 text-sm text-muted-foreground">The evidence behind every recommendation.</p></div></div></div>
      </section>
    </div>
  )
}
