import Link from "next/link"
import { firstHourSteps, type FirstHourSignals } from "@/lib/firstHour"

export function FirstHourChecklist({ signals }: { signals: FirstHourSignals }) {
  const steps = firstHourSteps(signals)

  return (
    <section
      aria-label="First hour"
      className="border border-[var(--roster-rule)] bg-[var(--roster-paper)] px-5 py-4"
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--roster-brass)]">First hour</p>
      <p className="mt-1 text-sm text-[var(--roster-signal)]">Three clicks so a decision reaches you.</p>
      <ol className="mt-4 space-y-3">
        {steps.map((step, i) => (
          <li key={step.id} className="flex gap-3">
            <span
              aria-hidden
              className={`mt-0.5 flex size-5 shrink-0 items-center justify-center font-mono text-[10px] ${
                step.done
                  ? "border border-[color-mix(in_srgb,var(--roster-brass)_55%,var(--roster-rule))] text-[var(--roster-brass)]"
                  : "border border-[var(--roster-rule)] text-[var(--roster-fog)]"
              }`}
            >
              {step.done ? "✓" : i + 1}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--roster-signal)]">
                {step.done ? <span className="sr-only">Done. </span> : null}
                {step.title}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--roster-fog)]">{step.hint}</p>
              {step.links.length > 0 && (
                <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  {step.links.map((link) => (
                    <Link
                      key={link.href + link.label}
                      href={link.href}
                      className="text-[var(--roster-brass)] underline-offset-2 hover:underline"
                    >
                      {link.label} →
                    </Link>
                  ))}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
