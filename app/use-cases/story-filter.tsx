"use client"

import { useEffect, useState, type ReactNode } from "react"

const audiences = [
  ["all", "All ten stories"],
  ["people", "People & engineers"],
  ["agents", "Autonomous agents"],
] as const

export function StoryFilter({ children }: { children: ReactNode }) {
  const [audience, setAudience] = useState<string>("all")
  useEffect(() => {
    const revealLinkedStory = () => {
      if (window.location.hash.startsWith("#case-")) {
        setAudience("all")
        requestAnimationFrame(() => {
          document.getElementById(window.location.hash.slice(1))?.scrollIntoView()
        })
      }
    }
    window.addEventListener("hashchange", revealLinkedStory)
    return () => window.removeEventListener("hashchange", revealLinkedStory)
  }, [])

  return (
    <div className="uc-filtered" data-audience={audience} onClick={(event) => {
      if (event.target instanceof Element && event.target.closest('a[href^="#case-"]')) setAudience("all")
    }}>
      <div className="uc-filter-row">
        <div className="uc-filters" role="group" aria-label="Filter stories by audience">
          {audiences.map(([value, label]) => <button key={value} type="button" aria-pressed={audience === value} onClick={() => setAudience(value)}>{label}</button>)}
        </div>
        <span className="uc-count" role="status">{audience === "all" ? 10 : 5} stories shown</span>
      </div>
      {children}
    </div>
  )
}
