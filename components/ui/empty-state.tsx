import type { ReactNode } from "react"

// A guiding empty state — never a dead end. `title` says what's (not) here in
// calm language; `hint` teaches what this surface is for and what action fills
// it. Server-safe (no client state) so any dashboard page can use it.
export function EmptyState({ title, hint, action }: { title: string; hint: string; action?: ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-muted/40 px-4 py-4">
      <p className="text-sm text-foreground">{title}</p>
      <p className="mt-1 max-w-xl text-xs leading-relaxed text-foreground0">{hint}</p>
      {action && <div className="mt-2.5">{action}</div>}
    </div>
  )
}
