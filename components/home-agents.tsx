"use client"

import Link from "next/link"
import { useMemo, useState } from "react"

// The agent list on the dashboard home: search, a three-way filter, and one
// collapsible section per group. Everything arrives formatted from the server
// (money, "3 min ago"), so this component only filters and folds.

export type HomeAgent = {
  id: string
  name: string
  holder: string | null
  stamp: "live" | "paused" | "blocked"
  month: string
  seen: string
}

export type HomeGroup = {
  id: string
  name: string
  depth: number
  month: string
  waiting: number
  agents: HomeAgent[]
}

type Filter = "all" | "paused" | "blocked"

// A long group shows this many agents until the person asks for the rest.
const PREVIEW = 12

const STATUS: Record<HomeAgent["stamp"], string> = {
  live: "Active",
  paused: "Waiting on you",
  blocked: "Off",
}

function Chevron() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="g-chev" aria-hidden>
      <path d="m9 6 6 6-6 6" />
    </svg>
  )
}

export function HomeAgents({ groups, total }: { groups: HomeGroup[]; total: number }) {
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<Filter>("all")
  // Small wallets open everything. Large ones open the top group and any group
  // with something waiting, so the page starts short.
  const [open, setOpen] = useState<Set<string>>(
    () => {
      // If the top group has no agents of its own, open the first group that
      // does, so the page never starts as a list of closed groups.
      const firstWithAgents = groups.find((g) => g.agents.length > 0)?.id
      return new Set(
        groups.filter((g, i) => total <= 24 || i === 0 || g.waiting > 0 || g.id === firstWithAgents).map((g) => g.id),
      )
    },
  )
  const [full, setFull] = useState<Set<string>>(() => new Set())

  const counts = useMemo(() => {
    const all = groups.flatMap((g) => g.agents)
    return {
      all: all.length,
      paused: all.filter((a) => a.stamp === "paused").length,
      blocked: all.filter((a) => a.stamp === "blocked").length,
    }
  }, [groups])

  const needle = query.trim().toLowerCase()
  const narrowing = needle !== "" || filter !== "all"
  const visible = useMemo(() => {
    if (!narrowing) return groups
    return groups
      .map((g) => ({
        ...g,
        agents: g.agents.filter(
          (a) =>
            (filter === "all" || a.stamp === filter) &&
            (needle === "" ||
              a.name.toLowerCase().includes(needle) ||
              (a.holder ?? "").toLowerCase().includes(needle) ||
              g.name.toLowerCase().includes(needle)),
        ),
      }))
      .filter((g) => g.agents.length > 0)
  }, [groups, narrowing, needle, filter])

  function toggle(set: Set<string>, id: string): Set<string> {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }

  const seg = (value: Filter, label: string, n: number) => (
    <button type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>
      {label}
      <span className="g-seg-n">{n}</span>
    </button>
  )

  return (
    <section className="home-section" aria-labelledby="home-agents">
      <div className="home-section-head" data-tour="roster-root">
        <h2 id="home-agents" className="home-h2">Agents</h2>
        <div className="agents-tools">
          <label className="agents-search">
            <span className="sr-only">Search agents</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name, person or group"
              className="g-input"
            />
          </label>
          <div className="g-seg" role="group" aria-label="Show">
            {seg("all", "All", counts.all)}
            {seg("paused", "Waiting", counts.paused)}
            {seg("blocked", "Off", counts.blocked)}
          </div>
        </div>
      </div>

      <div className="g-panel">
        {visible.length === 0 && (
          <p className="g-empty">
            {total === 0
              ? "No agents yet. Add one to get its key."
              : needle
                ? `No agents match “${query.trim()}”.`
                : filter === "paused"
                  ? "No agent is waiting on you."
                  : "No agents are switched off."}
          </p>
        )}
        {visible.map((group) => {
          const isOpen = narrowing || open.has(group.id)
          const showAll = narrowing || full.has(group.id) || group.agents.length <= PREVIEW
          const rows = showAll ? group.agents : group.agents.slice(0, PREVIEW)
          return (
            <div key={group.id} className="g-group">
              <button
                type="button"
                className="g-group-head"
                aria-expanded={isOpen}
                disabled={narrowing}
                onClick={() => setOpen((current) => toggle(current, group.id))}
                style={group.depth > 0 ? { paddingLeft: 18 + Math.min(group.depth, 3) * 18 } : undefined}
              >
                <Chevron />
                <span className="g-group-name">{group.name}</span>
                <span className="g-group-meta">
                  {group.agents.length} {group.agents.length === 1 ? "agent" : "agents"}
                </span>
                {/* Group totals describe the whole group, so they are hidden while
                    the list below shows only part of it. */}
                {!narrowing && group.waiting > 0 && <span className="g-pill-wait">{group.waiting} waiting</span>}
                {!narrowing && <span className="g-group-spend">{group.month}</span>}
              </button>
              {isOpen && group.agents.length > 0 && (
                <div className="g-rows">
                  {rows.map((agent) => (
                    <Link
                      key={agent.id}
                      href={`/dashboard/agents#seat-${agent.id}`}
                      data-tour="roster-agent"
                      className={`g-row${agent.stamp === "blocked" ? " g-row-off" : ""}`}
                    >
                      <span className="g-row-name">
                        <span className={`g-status g-status-${agent.stamp}`} aria-hidden />
                        <span>{agent.name}</span>
                        <span className="sr-only">, {STATUS[agent.stamp]}</span>
                      </span>
                      <span className="g-row-holder">{agent.holder ?? ""}</span>
                      <span className="g-row-seen" style={agent.stamp === "paused" ? { color: "var(--d-wait)", fontWeight: 600 } : undefined}>
                        {agent.stamp === "live" ? agent.seen : agent.stamp === "paused" ? "Waiting" : "Off"}
                      </span>
                      <span className="g-row-spend">{agent.month}</span>
                    </Link>
                  ))}
                  {!showAll && (
                    <button
                      type="button"
                      className="g-btn g-btn-quiet g-btn-sm g-more"
                      onClick={() => setFull((current) => toggle(current, group.id))}
                    >
                      Show all {group.agents.length}
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
