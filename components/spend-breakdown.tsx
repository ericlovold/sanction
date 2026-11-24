"use client"

import Link from "next/link"
import { useId, useRef, useState, type KeyboardEvent } from "react"

// "Where it went": one list at a time, switched by a segmented control.
// Everything arrives formatted from the server, so this only switches lists.

export type BreakdownRow = {
  key: string
  label: string
  /** Model ids read better in the mono face. */
  mono?: boolean
  sub: string
  amount: string
  /** A second line under the amount, e.g. the purchases part of a total. */
  detail?: string
  /** 0 to 1: this row against the largest in the list. */
  share: number
  href?: string
  chip?: string
}

export type BreakdownTab = {
  id: string
  label: string
  rows: BreakdownRow[]
  /** Shown when the list is empty. */
  empty: string
  /** A line under the list, e.g. how many agents had no activity. */
  note?: string
}

function Row({ row }: { row: BreakdownRow }) {
  const body = (
    <>
      <span className="sp-brk-main">
        <span className={`sp-brk-name${row.mono ? " pol-mono" : ""}`}>
          {row.label}
          {row.chip && <span className="sp-brk-chip">{row.chip}</span>}
        </span>
        <span className="sp-brk-sub">{row.sub}</span>
        <span className="sp-brk-bar" aria-hidden>
          <span style={{ width: `${Math.max(row.share > 0 ? 1.5 : 0, row.share * 100)}%` }} />
        </span>
      </span>
      <span className="sp-brk-amt">
        {row.amount}
        {row.detail && <span>{row.detail}</span>}
      </span>
    </>
  )
  return row.href ? (
    <Link href={row.href} className="sp-brk-row sp-brk-link">{body}</Link>
  ) : (
    <div className="sp-brk-row">{body}</div>
  )
}

// A long list shows this many rows until the person asks for the rest.
const PREVIEW = 8

export function SpendBreakdown({ tabs }: { tabs: BreakdownTab[] }) {
  const id = useId()
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const [active, setActive] = useState(tabs[0]?.id)
  const [full, setFull] = useState<string[]>([])
  const tab = tabs.find((t) => t.id === active) ?? tabs[0]
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number
    switch (event.key) {
      case "ArrowRight": next = (index + 1) % tabs.length; break
      case "ArrowLeft": next = (index + tabs.length - 1) % tabs.length; break
      case "Home": next = 0; break
      case "End": next = tabs.length - 1; break
      default: return
    }
    event.preventDefault()
    setActive(tabs[next].id)
    buttons.current[next]?.focus()
  }

  if (!tab) return null
  const showAll = full.includes(tab.id) || tab.rows.length <= PREVIEW
  const rows = showAll ? tab.rows : tab.rows.slice(0, PREVIEW)
  return (
    <section className="home-section" aria-labelledby={`${id}-where`}>
      <div className="home-section-head">
        <h2 id={`${id}-where`} className="home-h2">
          Where it went <span>this month</span>
        </h2>
        <div className="g-seg" role="tablist" aria-label="Break down by">
          {tabs.map((t, index) => (
            <button
              key={t.id}
              ref={(button) => { buttons.current[index] = button }}
              type="button"
              role="tab"
              id={`${id}-tab-${t.id}`}
              aria-controls={`${id}-panel-${t.id}`}
              aria-selected={t.id === tab.id}
              tabIndex={t.id === tab.id ? 0 : -1}
              onClick={() => setActive(t.id)}
              onKeyDown={(event) => navigate(event, index)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {tabs.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`${id}-panel-${t.id}`}
          aria-labelledby={`${id}-tab-${t.id}`}
          hidden={t.id !== tab.id}
          tabIndex={0}
          className="g-panel"
        >
          {t.id === tab.id && (
            <>
              {tab.rows.length === 0 ? (
                <p className="g-empty">{tab.empty}</p>
              ) : (
                <div className="sp-brk">
                  {rows.map((row) => <Row key={row.key} row={row} />)}
                  {tab.rows.length > PREVIEW && (
                    <button
                      type="button"
                      className="g-btn g-btn-quiet g-btn-sm sp-brk-more"
                      aria-expanded={showAll}
                      onClick={() => setFull((current) => current.includes(tab.id)
                        ? current.filter((expanded) => expanded !== tab.id)
                        : [...current, tab.id])}
                    >
                      {showAll ? "Show fewer" : `Show all ${tab.rows.length}`}
                    </button>
                  )}
                </div>
              )}
              {tab.note && <p className="sp-brk-note">{tab.note}</p>}
            </>
          )}
        </div>
      ))}
    </section>
  )
}
