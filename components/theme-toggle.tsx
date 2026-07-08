"use client"

import { useState } from "react"

// Theme: light is the default (the governance C-suite surface reads as an instrument
// panel, not a terminal). Dark is retained for operators who prefer it. The choice
// persists in localStorage and is applied pre-paint by the inline script in layout.tsx,
// so there's no flash — this component only reflects and toggles the already-set state.

type Theme = "light" | "dark"

function current(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light"
}

export function ThemeToggle({ collapsed = false }: { collapsed?: boolean }) {
  // Lazy init reads the class the pre-paint script already set — no effect, no flash.
  // On the server this returns "light" (the default) and hydration corrects it if needed.
  const [theme, setTheme] = useState<Theme>(() =>
    typeof document !== "undefined" ? current() : "light",
  )

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark"
    document.documentElement.classList.toggle("dark", next === "dark")
    try {
      localStorage.setItem("sanction-theme", next)
    } catch {
      // private mode / storage disabled — the toggle still works for this session
    }
    setTheme(next)
  }

  const isDark = theme === "dark"
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Light mode" : "Dark mode"}
      className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
      {!collapsed && <span>{isDark ? "Light" : "Dark"}</span>}
    </button>
  )
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="size-4 shrink-0">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="size-4 shrink-0">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </svg>
  )
}
