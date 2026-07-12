"use client"

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"

type Props = {
  children: ReactNode
  className?: string
  style?: CSSProperties
  /** Stagger delay in ms once visible */
  delay?: number
}

/**
 * Fade/rise reveal when the element enters the viewport.
 * prefers-reduced-motion is handled in CSS (.cx-reveal stays visible).
 */
export function CxReveal({ children, className, style, delay = 0 }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [on, setOn] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // CSS already forces visibility; mark on for consistency without a flash path.
      const id = window.requestAnimationFrame(() => setOn(true))
      return () => window.cancelAnimationFrame(id)
    }

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setOn(true)
          io.disconnect()
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className={["cx-reveal", on ? "is-on" : "", className].filter(Boolean).join(" ")}
      style={{
        ...style,
        transitionDelay: on && delay ? `${delay}ms` : undefined,
      }}
    >
      {children}
    </div>
  )
}
