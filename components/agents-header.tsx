"use client"

import { useState, type ReactNode } from "react"

// The Agents page header: title, one summary sentence, and the "Add agent"
// button that opens the creator directly underneath. The creator is passed in
// as children so this stays a thin shell around the existing component.
export function AgentsHeader({
  summary,
  startOpen,
  children,
}: {
  summary: string
  // Open the creator straight away, for a wallet with no agents yet.
  startOpen: boolean
  // The creator. Absent for people who cannot add agents.
  children?: ReactNode
}) {
  const [open, setOpen] = useState(startOpen)
  return (
    <>
      <header className="home-head">
        <div>
          <h1 className="home-title">Agents</h1>
          <p className="home-sub">{summary}</p>
        </div>
        {children ? (
          <div className="home-actions">
            <button
              type="button"
              aria-expanded={open}
              aria-controls="add-agents"
              onClick={() => setOpen((current) => !current)}
              className={`g-btn ${open ? "g-btn-quiet" : "g-btn-primary"}`}
            >
              {open ? (
                "Close"
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden width="15" height="15">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  Add agent
                </>
              )}
            </button>
          </div>
        ) : null}
      </header>
      {/* Hidden, not unmounted: closing the panel must not throw away a key
          that is shown only once. */}
      {children ? (
        <section id="add-agents" aria-label="Add agent" hidden={!open} className="g-panel seat-add home-section">
          {children}
        </section>
      ) : null}
    </>
  )
}
