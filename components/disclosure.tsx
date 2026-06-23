import type { ReactNode } from "react"

// Progressive disclosure. Native <details> — accessible, keyboard-friendly, no JS.
// Keeps the default onboarding view to one primary action; everything advanced
// lives one click away instead of stacked on screen.
export function Disclosure({ summary, children, defaultOpen = false }: { summary: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group rounded-md border border-zinc-800 bg-zinc-950/40">
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-xs font-medium text-zinc-400 transition-colors hover:text-zinc-200 [&::-webkit-details-marker]:hidden">
        <span>{summary}</span>
        <span className="text-zinc-600 transition-transform group-open:rotate-90">&rsaquo;</span>
      </summary>
      <div className="border-t border-zinc-800 p-3">{children}</div>
    </details>
  )
}
