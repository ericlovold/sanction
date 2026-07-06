import type { Metadata } from "next"
import { DocsHeader } from "@/components/docs-header"
import { ReadinessFlow } from "@/components/readiness-flow"

export const metadata: Metadata = {
  title: "The Agent Authority Readiness Check — Sanction",
  description:
    "Are your AI tools ready for real authority? A five-minute diagnostic that maps where AI could act in your organization — and where authority needs a gate. Returns your readiness level, risk map, and first governed workflow.",
}

// The lead-gen diagnostic. The frame is the product's frame: the question is
// not "are you using AI?", it's "what authority have you given it?" Everything
// here runs client-side (lib/readiness.ts is pure); the only write is the
// lead capture at the artifact moment.

// Print: the authority map prints as a light-scheme document — dark-theme
// text would land near-white on white paper once the browser strips
// backgrounds. Chrome hides itself; branding drops to one footer line.
const PRINT_STYLES = `
@media print {
  body { background: #fff !important; }
  #authority-map, #authority-map * {
    color: #18181b !important;
    border-color: #d4d4d8 !important;
    background: transparent !important;
  }
  #authority-map .print-accent { color: #047857 !important; }
  #authority-map li, #authority-map .rounded-lg, #authority-map h3 { break-inside: avoid; }
  #authority-map h3 { break-after: avoid; }
  main { max-width: 100% !important; padding: 0 !important; }
}
`

export default function Readiness() {
  return (
    <div className="min-h-screen">
      <style dangerouslySetInnerHTML={{ __html: PRINT_STYLES }} />
      <div className="print:hidden">
        <DocsHeader />
      </div>

      <main className="mx-auto max-w-3xl px-6 py-14">
        <p className="text-sm font-medium text-emerald-400">Readiness check</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-zinc-100">
          Are your AI agents ready for real authority?
        </h1>
        <p className="mt-3 text-zinc-400">
          If an AI tool could access credentials, spend money, email clients, use internal tools, or handle
          sensitive data, it needs authorization before execution. Five minutes, no signup — you leave with an
          authority map, not a score.
        </p>

        <div className="mt-10">
          <ReadinessFlow />
        </div>
      </main>
    </div>
  )
}
