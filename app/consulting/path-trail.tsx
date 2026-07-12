"use client"

import { useEffect, useId, useRef, useState, type ReactNode } from "react"

type Pt = { x: number; y: number }

/** Sine-weave through measured step centers (works horizontal or vertical). */
function weavePath(points: Pt[]): string {
  if (points.length < 2) return ""
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    const mx = (a.x + b.x) / 2
    const my = (a.y + b.y) / 2
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1
    const amp = Math.min(64, len * 0.42) * (i % 2 === 0 ? -1 : 1)
    const cx = mx + (-dy / len) * amp
    const cy = my + (dx / len) * amp
    d += ` Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`
  }
  return d
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n))
}

/**
 * Indiana Jones map trail: a dotted sine path through `.cx-step-node`
 * centers that reveals as the section scrolls into view.
 */
export function PathTrail({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const uid = useId().replace(/:/g, "")
  const maskId = `cx-trail-mask-${uid}`
  const gradId = `cx-trail-grad-${uid}`

  const [d, setD] = useState("")
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const measure = () => {
      const nodes = Array.from(root.querySelectorAll<HTMLElement>(".cx-step-node"))
      if (nodes.length < 2) return
      const rr = root.getBoundingClientRect()
      const pts: Pt[] = nodes.map((el) => {
        const r = el.getBoundingClientRect()
        return {
          x: r.left - rr.left + r.width / 2,
          y: r.top - rr.top + r.height / 2,
        }
      })
      setSize({ w: Math.max(1, rr.width), h: Math.max(1, rr.height) })
      setD(weavePath(pts))
    }

    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(root)
    window.addEventListener("resize", measure)
    const t = window.setTimeout(measure, 120)
    return () => {
      ro.disconnect()
      window.removeEventListener("resize", measure)
      window.clearTimeout(t)
    }
  }, [])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    let raf = 0

    const update = () => {
      raf = 0
      if (mq.matches) {
        setProgress(1)
        return
      }
      const rect = root.getBoundingClientRect()
      const vh = window.innerHeight || 1
      // Draw while the section travels through the viewport — slow map reveal.
      const start = vh * 0.82
      const end = vh * 0.18
      const travel = rect.height + (start - end)
      setProgress(clamp01((start - rect.top) / travel))
    }

    const onScroll = () => {
      if (raf) return
      raf = window.requestAnimationFrame(update)
    }

    update()
    mq.addEventListener("change", update)
    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll)
    return () => {
      mq.removeEventListener("change", update)
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
      if (raf) window.cancelAnimationFrame(raf)
    }
  }, [d])

  // Light step nodes as the trail reaches them.
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const nodes = Array.from(root.querySelectorAll<HTMLElement>(".cx-step-node"))
    const n = Math.max(1, nodes.length - 1)
    nodes.forEach((el, i) => {
      el.dataset.lit = progress >= i / n - 0.02 ? "1" : "0"
    })
  }, [progress])

  const drawn = progress

  return (
    <div ref={rootRef} className="cx-trail-root">
      {size.w > 0 && d ? (
        <svg
          className="cx-trail-svg"
          width={size.w}
          height={size.h}
          viewBox={`0 0 ${size.w} ${size.h}`}
          aria-hidden
        >
          <defs>
            <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="var(--pine-7)" />
              <stop offset="50%" stopColor="var(--ochre-6)" />
              <stop offset="100%" stopColor="var(--pine-7)" />
            </linearGradient>
            {/* White stroke grows along the path → reveals the dotted trail. */}
            <mask id={maskId} maskUnits="userSpaceOnUse">
              <path
                d={d}
                fill="none"
                stroke="#fff"
                strokeWidth={10}
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength={1}
                strokeDasharray={`${drawn} 1`}
              />
            </mask>
          </defs>
          {/* Ghost full route — faint destination hint */}
          <path
            d={d}
            fill="none"
            stroke="var(--pine-6)"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="1.5 11"
            opacity={0.14}
          />
          {/* Revealing dotted trail */}
          <path
            d={d}
            fill="none"
            stroke={`url(#${gradId})`}
            strokeWidth={2.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="1.8 10"
            mask={`url(#${maskId})`}
          />
        </svg>
      ) : null}
      {children}
    </div>
  )
}
