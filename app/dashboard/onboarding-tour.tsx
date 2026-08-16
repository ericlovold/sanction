"use client"

// Guided onboarding: spotlight + arrow overlays, each
// anchored to the REAL element it teaches (data-tour attributes). Auto-opens
// once for a first visit (localStorage), restartable via the Tour
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
    target: "roster-root",
    title: "1 · The roster",
    body: "This is the group. Agents live on it. Child groups nest under it. Spend and the mandate stamp sit on the card — not on a report of zeros.",
  },
  {
    target: "roster-add",
    title: "2 · Add an agent",
    body: "Name it. Create. Copy the key once. The card appears in this group.",
  },
  {
    target: "nav-approvals",
    title: "3 · Approve",
    body: "When a request crosses the line it pauses here. Approve mints a single-use grant. The stamp on the agent card reads paused until you decide.",
  },
  {
    target: "nav-vault",
    title: "4 · Vault",
    body: "Credentials, providers, people, policy, spend, and the signed record. Properties of the wallet — not nine icons on the rail.",
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
      Tour
    </button>
  )
}
