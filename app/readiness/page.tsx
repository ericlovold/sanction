import type { Metadata } from "next"
import Link from "next/link"
import { ReadinessFlow } from "@/components/readiness-flow"
import "../brand.css"
import { brandFontVars } from "../brand-fonts"

export const metadata: Metadata = {
  title: "The Agent Authority Readiness Check — Sanction",
  description:
    "Are your AI tools ready for real authority? A five-minute diagnostic that maps where AI could act in your organization — and where authority needs a gate. Returns your readiness level, risk map, and first governed workflow.",
}

// The lead-gen diagnostic, in the marketing skin (green-and-cream brand
// system, Instrument Sans) — this page is for buyers, not operators. The
// frame is the product's frame: the question is not "are you using AI?",
// it's "what authority have you given it?" Everything runs client-side
// (lib/readiness.ts is pure); the only write is the lead capture at the
// artifact moment.

// Print: the authority map prints as a document — chrome hides itself,
// colors force to ink-on-white, branding drops to one footer line.
const PRINT_STYLES = `
@media print {
  body { background: #fff !important; }
  #authority-map, #authority-map * {
    color: #16180f !important;
    border-color: #d4d4d8 !important;
    background: transparent !important;
  }
  #authority-map .print-accent { color: #124a3a !important; }
  #authority-map li, #authority-map .rounded-lg, #authority-map h3 { break-inside: avoid; }
  #authority-map h3 { break-after: avoid; }
  main { max-width: 100% !important; padding: 0 !important; }
}
`

export default function Readiness() {
  return (
    <div className={`sanction ${brandFontVars}`} style={{ minHeight: "100vh", background: "var(--surface-page)", color: "var(--text-body)" }}>
      <style dangerouslySetInnerHTML={{ __html: PRINT_STYLES }} />

      <nav className="print:hidden" style={{ borderBottom: "1px solid var(--paper-3)" }}>
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-6">
          <Link href="/" style={{ fontWeight: 600, fontSize: 17, letterSpacing: "-0.02em" }}>
            Sanction
          </Link>
          <div className="flex items-center gap-3">
            <Link className="sanction-link" href="/local" style={{ fontSize: 14 }}>
              Sanction Local
            </Link>
            <Link className="sn-btn sn-btn-primary sn-btn-s" href="/start">
              Start free
            </Link>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-3xl px-6 py-14">
        <p className="sn-mono" style={{ color: "var(--status-approved)", fontSize: 13 }}>
          Readiness check
        </p>
        <h1 style={{ font: "var(--text-h1)", letterSpacing: "-0.02em", marginTop: 10 }}>
          Are your AI agents ready for real authority?
        </h1>
        <p style={{ font: "var(--text-body-l)", color: "var(--text-secondary)", maxWidth: "58ch", marginTop: 14 }}>
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
