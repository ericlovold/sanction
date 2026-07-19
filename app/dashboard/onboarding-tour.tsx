"use client"

// The 5/5 guided onboarding: five steps, spotlight + arrow overlays, each
// anchored to the REAL element it teaches (data-tour attributes). Auto-opens
// once for a first visit (localStorage), restartable via the "5-step tour"
// chip or ?tour=1. No dependencies — a backdrop with a cut-out ring, a card
// positioned beside the target, Back/Next/Skip.

import { useCallback, useEffect, useMemo, useState } from "react"
import { track } from "@vercel/analytics"
import { FUNNEL } from "@/lib/funnel"

type Step = {
  target: string // data-tour value
  title: string
  body: string
}

const STEPS: Step[] = [
  {
    target: "nav-providers",
    title: "1 · Pull in your data",
    body: "Connect Anthropic, OpenAI, or Google once — the key is encrypted into your vault. From then on your agents only ever hold Sanction seat keys, and every model call flows through the gateway, metered.",
  },
  {
    target: "budget-card",
    title: "2 · See it",
    body: "Where you are on AI spend, always current: month against budget, week and quarter, and which provider the tokens went to. This is the answer to “where are we on our monthly AI spend?”",
  },
  {
    target: "nav-agents",
    title: "3 · Seats, teams, budgets",
    body: "Every agent gets a seat: its own key, its own budgets, its own audit trail. Group seats into Pools — departments with shared caps — and spend rolls up the tree.",
  },
  {
    target: "decisions-card",
    title: "4 · Approve",
    body: "Anything over your escalation line pauses HERE until a human decides. Approving mints a single-use grant the agent retries with — try it on a live one right now.",
  },
  {
    target: "nav-policy",
    title: "5 · Govern",
    body: "Policy is the ladder: auto-approve under a line, escalate above it, hard-deny at the cap. And Audit is the signed, tamper-evident record of every decision — the evidence layer.",
  },
]

const DONE_KEY = "sanction-tour-done"

function targetRect(name: string): DOMRect | null {
  const el = document.querySelector(`[data-tour="${name}"]`)
  return el ? el.getBoundingClientRect() : null
}

export function OnboardingTour({ autoStart }: { autoStart: boolean }) {
  const [step, setStep] = useState<number | null>(null)
  const [rect, setRect] = useState<DOMRect | null>(null)

  const open = useCallback((i: number) => {
    const el = document.querySelector(`[data-tour="${STEPS[i].target}"]`)
    el?.scrollIntoView({ block: "center", behavior: "smooth" })
    setStep(i)
  }, [])

  // Auto-open once per browser; ?tour=1 always reopens. Deferred a frame so the
  // first paint is the real dashboard (the thing the tour points at), then the
  // overlay arrives — and setState lands outside the synchronous effect body.
  useEffect(() => {
    const forced = new URLSearchParams(window.location.search).get("tour") === "1"
    const done = localStorage.getItem(DONE_KEY)
    if (!(forced || (autoStart && !done))) return
    try {
      track(FUNNEL.tourStarted, { trigger: forced ? "relaunch" : "auto" })
    } catch {
      /* best-effort */
    }
    const raf = requestAnimationFrame(() => open(0))
    return () => cancelAnimationFrame(raf)
  }, [autoStart, open])

  // Track the target's rect (scroll/resize) while a step is showing.
  useEffect(() => {
    if (step === null) return
    const update = () => setRect(targetRect(STEPS[step].target))
    update()
    const t = setInterval(update, 250) // cheap + robust vs. layout shifts
    window.addEventListener("resize", update)
    window.addEventListener("scroll", update, true)
    return () => {
      clearInterval(t)
      window.removeEventListener("resize", update)
      window.removeEventListener("scroll", update, true)
    }
  }, [step])

  const finish = useCallback(() => {
    localStorage.setItem(DONE_KEY, "1")
    setStep(null)
  }, [])

  // Distinct from Skip/dismiss: the visitor walked to the end. This is the
  // tour's assist signal — did completing it lift wallet creation?
  const complete = useCallback(() => {
    try {
      track(FUNNEL.tourCompleted, { via: "done" })
    } catch {
      /* best-effort */
    }
    finish()
  }, [finish])

  const card = useMemo(() => {
    if (step === null || !rect) return null
    const s = STEPS[step]
    // Place the card to the right of the target when there's room, else below.
    const spaceRight = window.innerWidth - rect.right
    const side: "right" | "below" = spaceRight > 360 ? "right" : "below"
    const style: React.CSSProperties =
      side === "right"
        ? { top: Math.max(16, Math.min(rect.top, window.innerHeight - 240)), left: rect.right + 18 }
        : { top: rect.bottom + 18, left: Math.max(16, Math.min(rect.left, window.innerWidth - 356)) }
    return { s, side, style }
  }, [step, rect])

  if (step === null) return null

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="Product tour">
      {/* Backdrop with a spotlight ring around the target */}
      <div className="absolute inset-0 bg-black/50" onClick={finish} />
      {rect && (
        <div
          aria-hidden
          className="absolute rounded-lg ring-2 ring-emerald-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.5)] transition-all duration-200"
          style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }}
        />
      )}
      {card && (
        <div className="absolute w-[340px] rounded-lg border border-border bg-card p-4 shadow-xl" style={card.style}>
          {/* Arrow toward the target */}
          <div
            aria-hidden
            className={`absolute h-3 w-3 rotate-45 border-border bg-card ${
              card.side === "right" ? "-left-1.5 top-6 border-b border-l" : "-top-1.5 left-8 border-l border-t"
            }`}
          />
          <p className="text-sm font-semibold">{card.s.title}</p>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{card.s.body}</p>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">{step + 1} of {STEPS.length}</span>
            <span className="flex gap-2">
              <button onClick={finish} className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted">
                Skip
              </button>
              {step > 0 && (
                <button onClick={() => open(step - 1)} className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted">
                  Back
                </button>
              )}
              {step < STEPS.length - 1 ? (
                <button onClick={() => open(step + 1)} className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground">
                  Next
                </button>
              ) : (
                <button onClick={complete} className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground">
                  Done — it&apos;s yours
                </button>
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

export function TourLauncher() {
  return (
    <button
      onClick={() => {
        localStorage.removeItem(DONE_KEY)
        const url = new URL(window.location.href)
        url.searchParams.set("tour", "1")
        window.location.href = url.toString()
      }}
      className="rounded-full border border-emerald-500/40 px-3 py-1 text-xs text-emerald-500 hover:bg-emerald-500/[0.08]"
    >
      5-step tour
    </button>
  )
}
