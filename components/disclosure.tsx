import type { ReactNode } from "react"

// Progressive disclosure. Native <details> — accessible, keyboard-friendly, no JS.
// Keeps the default onboarding view to one primary action; everything advanced
// lives one click away instead of stacked on screen.
// "light" renders with brand.css tokens — only use inside a `.sanction`-scoped
// page (e.g. /start) where the CSS variables resolve.
export function Disclosure({
  summary,
  children,
  defaultOpen = false,
  variant = "dark",
}: {
  summary: string
  children: ReactNode
  defaultOpen?: boolean
  variant?: "dark" | "light"
}) {
  const light = variant === "light"
  return (
    <details
      open={defaultOpen}
      className={light ? "group rounded-md border" : "group rounded-md border border-zinc-800 bg-zinc-950/40"}
      style={light ? { borderColor: "var(--paper-3)", background: "var(--surface-card)" } : undefined}
    >
      <summary
        className={
          light
            ? "sanction-link flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-xs font-medium [&::-webkit-details-marker]:hidden"
            : "flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-xs font-medium text-zinc-400 transition-colors hover:text-zinc-200 [&::-webkit-details-marker]:hidden"
        }
      >
        <span>{summary}</span>
        <span
          className={light ? "transition-transform group-open:rotate-90" : "text-zinc-600 transition-transform group-open:rotate-90"}
          style={light ? { color: "var(--text-muted)" } : undefined}
        >
          &rsaquo;
        </span>
      </summary>
      <div className={light ? "border-t p-3" : "border-t border-zinc-800 p-3"} style={light ? { borderColor: "var(--paper-3)" } : undefined}>
        {children}
      </div>
    </details>
  )
}
