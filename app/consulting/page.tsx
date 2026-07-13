import type { Metadata } from "next"
import Link from "next/link"
import { Permanent_Marker } from "next/font/google"
import "../brand.css"
import { brandFontVars } from "../brand-fonts"
import { PathTrail } from "./path-trail"
import { CxReveal } from "./reveal"

// Playbook scrawl for the industries fan — loaded here only so no other page pays for it.
const marker = Permanent_Marker({ weight: "400", subsets: ["latin"] })

export const metadata: Metadata = {
  title: "AI Consulting — Eric Lovold | Working AI for real businesses",
  description:
    "Eric Lovold installs working AI on real business workflows: implementation, internal tools, content systems, and coaching for SMBs and regulated teams. Discovery is free, and you'll leave with ideas either way.",
}

// Discovery Calendly. NEXT_PUBLIC_CALENDLY_URL overrides at build time.
const CALENDLY_URL =
  process.env.NEXT_PUBLIC_CALENDLY_URL || "https://calendly.com/eric-getsanction/discover"

const wrap: React.CSSProperties = { maxWidth: 1120, margin: "0 auto", padding: "0 32px" }

// Arrow endpoints for the industries play fan, in the 1020-wide SVG space.
// Tuned to the rendered pill centers at full width; the fan hides below 1120px.
const LANE_X = [181, 382, 538, 665, 838]

const PAIN_POINTS: [string, string][] = [
  [
    "You posted an AI role that isn't filling",
    "The person who can build AI and also understand your business is a unicorn. Big tech pays them more than the role makes sense for, and the work is still sitting there.",
  ],
  [
    "You tried the tools and nothing stuck",
    "Someone bought licenses, a few people experimented, the excitement faded. It happens when nobody installs AI on the way you actually work.",
  ],
  [
    "Your team is at capacity and the asks keep coming",
    "You don't need more headcount to deliver more. You need the repetitive half of the work to run itself so your people can spend their hours on judgment.",
  ],
]

const STEPS: [string, string, string][] = [
  [
    "1",
    "A real conversation",
    "Thirty minutes of discovery about your goals and where you are. You'll walk away with my honest read and the ideas I'd run at first, whether we work together or not.",
  ],
  [
    "2",
    "A look at your workflows",
    "I map where the hours actually go and where AI removes friction, measured against real outcomes. You get the map either way.",
  ],
  [
    "3",
    "A first build with a fixed scope",
    "One concrete thing, priced exactly before any work starts. A workflow that runs itself, an internal tool, a content system. Your team puts its hands on it in weeks.",
  ],
  [
    "4",
    "A simple ongoing rhythm",
    "Keep building monthly, or have me embedded a few days a month as your fractional AI operator.",
  ],
]

const SERVICE_GLYPHS: Record<string, React.ReactNode> = {
  workflows: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 6h6M4 12h10M4 18h7" />
      <circle cx="17" cy="6" r="2.4" />
      <circle cx="19" cy="18" r="2.4" />
    </svg>
  ),
  tools: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M9 9l-2 3 2 3M15 9l2 3-2 3" />
    </svg>
  ),
  content: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 19l1.5-5L16 4.5a2.1 2.1 0 013 3L9.5 17 5 19z" />
      <path d="M13 7.5l3 3" />
    </svg>
  ),
  web: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.6 2.4 3.8 5.4 3.8 8.5S14.6 18 12 20.5C9.4 18 8.2 15.1 8.2 12S9.4 5.9 12 3.5z" />
    </svg>
  ),
}

const SERVICES: { key: string; title: string; body: string }[] = [
  {
    key: "workflows",
    title: "AI workflows & setup",
    body: "Tools, automations, and guardrails installed on your team's real work: intake, follow-ups, reporting, the recurring hours. The morning that runs itself.",
  },
  {
    key: "tools",
    title: "Internal tools & apps",
    body: "The tool your team has wanted for years but could never justify a dev shop for. Building with AI makes it affordable now. Scoped, shipped, and dependable in production.",
  },
  {
    key: "content",
    title: "Content systems, in your voice",
    body: "Your voice stays yours. AI makes your team faster at drafting, structuring, and repurposing, so what ships still sounds like your company.",
  },
  {
    key: "web",
    title: "Websites that work",
    body: "A modern site built AI-fast: designed, written with you, instrumented, and live in weeks. The same way I build for my own company.",
  },
]

const ALSO: [string, string][] = [
  [
    "Vet your AI hire",
    "A lot of companies find out five months in that their AI director can talk AI but can't ship it. I'll help you interview and evaluate candidates before the salary bet.",
  ],
  ["Executive coaching", "Direct 1:1 work on AI tools, workflows, and judgment for leaders. Practical and current."],
  ["Design sprints", "A focused week from problem to working prototype your team can evaluate with its own hands."],
]

const WONT: string[] = [
  "Sell you “transformation.” You'll get specific systems with names, owners, and measured outcomes.",
  "Automate your voice away. Anything a human reads as you stays written by you. AI makes you faster.",
  "Ship anything you can't see into. If it touches your data or your customers, you can audit what it did and turn it off.",
  "Build dependency. If you can't run it without me when I leave, I haven't finished the job.",
]

// Eric's Anthropic credentials (issued Mar 2026) — a light-touch trust strip
// near the top of the page. Clio is called out separately below the row.
const CERTS: string[] = [
  "Claude in Amazon Bedrock",
  "Claude Code in Action",
  "MCP: Advanced Topics",
  "Introduction to MCP",
  "Introduction to Agent Skills",
  "Building with the Claude API",
  "AI Fluency: Framework & Foundations",
  "AI Fluency for Educators",
  "Claude 101",
]

const css = `
@keyframes cxUp { to { opacity: 1; transform: none } }
.cx-fade { opacity: 0; transform: translateY(14px); animation: cxUp .7s cubic-bezier(.2,.7,.2,1) forwards }
.cx-d1 { animation-delay: .05s } .cx-d2 { animation-delay: .15s } .cx-d3 { animation-delay: .25s }
.cx-d4 { animation-delay: .35s } .cx-d5 { animation-delay: .45s }
.cx-lift { transition: transform .25s ease, box-shadow .25s ease, border-color .25s ease }
.cx-lift:hover { transform: translateY(-4px); box-shadow: 0 14px 34px rgba(22,24,15,.10); border-color: var(--pine-6) }
.cx-steps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 28px; position: relative; z-index: 1 }
.cx-play { display: flex; justify-content: center; margin-top: 4px; overflow: hidden }
.cx-play svg { display: block; flex: none }
.cx-lane { stroke-dasharray: 1; stroke-dashoffset: 1; animation: cxDraw .9s cubic-bezier(.4,0,.2,1) forwards }
.cx-lane-tip { opacity: 0; animation: cxTip .3s ease-out forwards }
@keyframes cxDraw { to { stroke-dashoffset: 0 } }
@keyframes cxTip { to { opacity: 1 } }
.cx-play-call { text-align: center; font-size: 27px; letter-spacing: .05em; text-transform: uppercase;
  color: var(--ink); transform: rotate(-2deg); margin-top: 2px }

/* Indiana Jones trail overlay */
.cx-trail-root { position: relative; overflow: visible }
.cx-trail-svg { position: absolute; pointer-events: none; z-index: 0; overflow: visible }
.cx-step-node {
  transition: transform .35s cubic-bezier(.2,.7,.2,1), box-shadow .35s ease, filter .35s ease;
  box-shadow: 0 0 0 0 rgba(35,121,95,0);
}
.cx-step-node[data-lit="1"] {
  transform: scale(1.06);
  box-shadow: 0 0 0 4px rgba(35,121,95,.12), 0 8px 22px rgba(22,24,15,.10);
  filter: saturate(1.05);
}

/* Mathematical graph paper — minor + major grid */
.cx-graph {
  background-color: var(--paper-1);
  background-image:
    linear-gradient(rgba(22,24,15,.045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(22,24,15,.045) 1px, transparent 1px),
    linear-gradient(rgba(23,97,75,.07) 1px, transparent 1px),
    linear-gradient(90deg, rgba(23,97,75,.07) 1px, transparent 1px);
  background-size: 24px 24px, 24px 24px, 120px 120px, 120px 120px;
  background-position: -1px -1px, -1px -1px, -1px -1px, -1px -1px;
}
.cx-graph-soft {
  background-color: transparent;
  background-image:
    linear-gradient(rgba(22,24,15,.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(22,24,15,.035) 1px, transparent 1px),
    linear-gradient(rgba(193,146,47,.06) 1px, transparent 1px),
    linear-gradient(90deg, rgba(193,146,47,.06) 1px, transparent 1px);
  background-size: 20px 20px, 20px 20px, 100px 100px, 100px 100px;
}

/* Scroll reveals */
.cx-reveal {
  opacity: 0;
  transform: translateY(18px);
  transition: opacity .7s cubic-bezier(.2,.7,.2,1), transform .7s cubic-bezier(.2,.7,.2,1);
}
.cx-reveal.is-on { opacity: 1; transform: none }

/* Hand-drawn pain points — marker text writes on left→right, arrows draw in */
.cx-write { display: inline-block; clip-path: inset(0 100% 0 -8%); transition: clip-path .85s cubic-bezier(.4,0,.2,1) .1s }
.cx-reveal.is-on .cx-write { clip-path: inset(0 -8% 0 -8%) }
.cx-hand path { stroke-dasharray: 1; stroke-dashoffset: 1; transition: stroke-dashoffset .8s ease .25s }
.cx-reveal.is-on .cx-hand path { stroke-dashoffset: 0 }

/* Geometric corner ticks — mathematical frame accent */
.cx-frame {
  position: relative;
}
.cx-frame::before, .cx-frame::after {
  content: "";
  position: absolute;
  width: 18px; height: 18px;
  border-color: var(--pine-6);
  border-style: solid;
  opacity: .35;
  pointer-events: none;
}
.cx-frame::before { top: 12px; left: 12px; border-width: 1.5px 0 0 1.5px }
.cx-frame::after { bottom: 12px; right: 12px; border-width: 0 1.5px 1.5px 0 }

/* Axis tick marks under section labels */
.cx-axis {
  display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 18px;
}
.cx-axis span {
  display: block; width: 6px; height: 6px; border-radius: 1px;
  background: var(--pine-6); opacity: .35; transform: rotate(45deg);
}
.cx-axis i {
  display: block; height: 1px; width: 48px;
  background: linear-gradient(90deg, transparent, var(--pine-6), transparent);
  opacity: .35; font-style: normal;
}

@media (max-width: 1119px) {
  .cx-play { display: none }
  .cx-play-call { margin-top: 20px; font-size: 22px }
}
@media (max-width: 900px) {
  .cx-steps { grid-template-columns: 1fr }
}
@media (prefers-reduced-motion: reduce) {
  .cx-fade { animation: none; opacity: 1; transform: none }
  .cx-lift, .cx-lift:hover { transition: none; transform: none }
  .cx-lane { animation: none; stroke-dashoffset: 0 }
  .cx-lane-tip { animation: none; opacity: 1 }
  .cx-reveal { opacity: 1; transform: none; transition: none }
  .cx-write { clip-path: none; transition: none }
  .cx-hand path { stroke-dashoffset: 0; transition: none }
  .cx-step-node, .cx-step-node[data-lit="1"] { transition: none; transform: none }
}
`

export default function Consulting() {
  return (
    <main className={`sanction ${brandFontVars}`} style={{ minHeight: "100vh" }}>
      <style dangerouslySetInnerHTML={{ __html: css }} />

      {/* Nav */}
      <nav style={{ position: "sticky", top: 0, zIndex: 40, background: "rgba(251,250,246,.8)", backdropFilter: "blur(12px)", borderBottom: "1px solid var(--line-2)" }}>
        <div style={{ ...wrap, display: "flex", alignItems: "center", gap: 32, height: 64 }}>
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 600, fontSize: 17, letterSpacing: "-0.02em" }}>
            <img src="/brand/sanction-mark.svg" alt="" style={{ width: 24, height: 24 }} />
            Sanction
          </Link>
          <div className="sn-nav-links" style={{ display: "flex", gap: 24, fontSize: 14, marginLeft: 16, whiteSpace: "nowrap" }}>
            <Link className="sanction-link" href="/">Product</Link>
            <a className="sanction-link" href="#services">Services</a>
            <Link className="sanction-link" href="/about">About</Link>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
            <a className="sn-btn sn-btn-primary sn-btn-s" href={CALENDLY_URL} target="_blank" rel="noopener">
              Book discovery
            </a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <header
        style={{
          backgroundImage: "radial-gradient(90% 60% at 50% -10%, var(--pine-tint) 0%, rgba(228,239,232,0) 70%), radial-gradient(36% 28% at 88% 42%, var(--ochre-tint) 0%, rgba(246,236,214,0) 75%)",
        }}
      >
        <div style={{ ...wrap, padding: "96px 32px 56px", maxWidth: 780, textAlign: "center" }}>
          <h1 className="cx-fade cx-d1" style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>
            Let&apos;s put AI to work for your business.
          </h1>
          <div className="cx-fade cx-d4" style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 28, flexWrap: "wrap" }}>
            <a className="sn-btn sn-btn-primary sn-btn-l" href={CALENDLY_URL} target="_blank" rel="noopener">
              Book discovery →
            </a>
            <a className="sn-btn sn-btn-l" href="#how" style={{ border: "1px solid var(--line-1)", background: "var(--surface-card)" }}>
              How it works
            </a>
          </div>
        </div>
        {/* Who I work with — five buckets, play-diagram fan up from the call */}
        <div style={{ ...wrap, padding: "8px 32px 72px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center", position: "relative", zIndex: 1 }}>
            {["Healthcare & benefits", "Financial services", "Insurance", "Real estate", "Professional services"].map((i, idx) => (
              <span key={i} className="sn-mono" style={{ color: idx % 2 ? "var(--ochre-7)" : "var(--pine-7)", borderRadius: "var(--radius-pill)", padding: "8px 16px", letterSpacing: "0.08em", background: idx % 2 ? "var(--ochre-tint)" : "var(--pine-tint)" }}>
                {i}
              </span>
            ))}
          </div>
          <div className="cx-play" aria-hidden="true">
            <svg viewBox="0 0 1020 122" width={1020} height={122} fill="none">
              {LANE_X.map((x, idx) => {
                const c = idx % 2 ? "var(--ochre-7)" : "var(--pine-7)"
                return (
                  <g key={x} stroke={c} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                    <path className="cx-lane" style={{ animationDelay: `${0.15 + idx * 0.12}s` }} pathLength={1} d={`M 510 120 C 510 54 ${x} 100 ${x} 20`} />
                    <path className="cx-lane-tip" style={{ animationDelay: `${0.85 + idx * 0.12}s` }} d={`M ${x - 8} 30 L ${x} 14 L ${x + 8} 30`} />
                  </g>
                )
              })}
            </svg>
          </div>
          <div className={`${marker.className} cx-play-call`}>Lean teams everywhere</div>
        </div>
      </header>

      {/* Credentials — light Anthropic-certified trust strip */}
      <section style={{ borderTop: "1px solid var(--line-2)", background: "var(--pine-tint)" }}>
        <div style={{ ...wrap, padding: "26px 32px", textAlign: "center" }}>
          <div className="sn-mono" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "var(--pine-7)", letterSpacing: "0.12em", fontSize: 12, marginBottom: 14 }}>
            <span aria-hidden style={{ color: "var(--ochre-6)" }}>◆</span> ANTHROPIC CERTIFIED
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
            {CERTS.map((c) => (
              <span key={c} className="sn-mono" style={{ fontSize: 11.5, letterSpacing: "0.02em", color: "var(--text-secondary)", background: "var(--surface-card)", border: "1px solid var(--line-1)", borderRadius: "var(--radius-pill)", padding: "5px 12px" }}>
                {c}
              </span>
            ))}
          </div>
          <p style={{ margin: "14px 0 0", fontSize: 12.5, color: "var(--text-muted)" }}>
            Also certified: <span style={{ color: "var(--text-secondary)" }}>Clio Legal AI Fundamentals</span>
          </p>
        </div>
      </section>

      {/* The path — Indiana Jones dotted trail weaves through the steps */}
      <section id="how" className="cx-graph" style={{ borderTop: "1px solid var(--line-2)", overflow: "visible" }}>
        <div style={{ ...wrap, padding: "88px 32px" }}>
          <CxReveal style={{ maxWidth: 620, margin: "0 auto 56px", textAlign: "center" }}>
            <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>
              A clear path from &ldquo;we should be using AI&rdquo; to &ldquo;we are.&rdquo;
            </h2>
            <div className="cx-axis" aria-hidden>
              <span /><i /><span /><i /><span />
            </div>
          </CxReveal>
          <PathTrail>
            <div className="cx-steps">
              {STEPS.map(([n, t, d], idx) => (
                <div key={n} style={{ position: "relative" }}>
                  <div
                    className="cx-step-node"
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: "50%",
                      background: idx % 2 ? "var(--ochre-6)" : "var(--pine-8)",
                      color: "#fdfcf8",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 600,
                      fontSize: 17,
                      position: "relative",
                      zIndex: 1,
                      border: "4px solid var(--paper-1)",
                    }}
                  >
                    {n}
                  </div>
                  <h3 style={{ margin: "18px 0 8px", font: "var(--text-h3)" }}>{t}</h3>
                  <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "var(--text-secondary)" }}>{d}</p>
                </div>
              ))}
            </div>
          </PathTrail>
        </div>
      </section>


      {/* You might be here because — hand-drawn, marker font + drawn arrows */}
      <section style={{ borderTop: "1px solid var(--line-2)" }}>
        <div style={{ ...wrap, padding: "88px 32px" }}>
          <CxReveal style={{ maxWidth: 620, margin: "0 auto 56px", textAlign: "center" }}>
            <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>
              You might be here because&hellip;
            </h2>
            <p style={{ fontSize: 15.5, color: "var(--text-secondary)", margin: "14px 0 0" }}>
              All of these are more common than you think. All of them are fixable.
            </p>
          </CxReveal>
          <div style={{ maxWidth: 780, margin: "0 auto", display: "grid", gap: 44 }}>
            {PAIN_POINTS.map(([t, d], i) => {
              const c = i % 2 ? "var(--ochre-6)" : "var(--pine-7)"
              return (
                <CxReveal key={t} delay={i * 160}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 18, flexWrap: "wrap" }}>
                    <span className={`${marker.className} cx-write`} style={{ fontSize: 58, lineHeight: 1, color: c, flex: "none" }}>{i + 1}</span>
                    <svg className="cx-hand" width={70} height={46} viewBox="0 0 70 46" fill="none" aria-hidden style={{ flex: "none", marginTop: 14 }}>
                      <path pathLength={1} d="M4 34 C 24 34 33 13 57 15" stroke={c} strokeWidth={2.6} strokeLinecap="round" />
                      <path pathLength={1} d="M47 7 L59 15 L47 23" stroke={c} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <div style={{ flex: "1 1 320px", minWidth: 260 }}>
                      <p className={`${marker.className} cx-write`} style={{ margin: "4px 0 8px", fontSize: 25, lineHeight: 1.3, color: "var(--ink)" }}>{t}</p>
                      <p style={{ margin: 0, fontSize: 15, lineHeight: 1.65, color: "var(--text-secondary)" }}>{d}</p>
                    </div>
                  </div>
                </CxReveal>
              )
            })}
          </div>
        </div>
      </section>

      {/* Final CTA — deep pine band */}
      <section
        id="book"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(247,246,240,.07) 1px, transparent 1px), radial-gradient(90% 120% at 50% 115%, var(--pine-7) 0%, var(--pine-9) 68%)",
          backgroundSize: "28px 28px, auto",
          color: "#f7f6f0",
        }}
      >
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "96px 32px", textAlign: "center" }}>
          <CxReveal>
            <h2 style={{ margin: 0, font: "var(--text-h2)", letterSpacing: "var(--tracking-heading)", color: "#f7f6f0" }}>
              Not sure where AI fits your business? Let&apos;s find out.
            </h2>
            <p style={{ fontSize: 16, lineHeight: 1.6, color: "rgba(247,246,240,.75)", margin: "12px 0 28px" }}>
              Thirty minutes. You&apos;ll leave with ideas you can use whether we ever work together or not.
            </p>
            <a
              className="sn-btn sn-btn-l"
              href={CALENDLY_URL}
              target="_blank"
              rel="noopener"
              style={{
                background: "var(--ochre-6)",
                color: "var(--pine-9)",
                fontWeight: 700,
                border: "1px solid rgba(247,246,240,.18)",
                boxShadow: "0 14px 32px rgba(193,146,47,.28)",
              }}
            >
              Book discovery →
            </a>
            <p style={{ fontSize: 13.5, color: "rgba(247,246,240,.6)", marginTop: 16 }}>
              Or email <a href="mailto:eric@getsanction.com" style={{ color: "#f7f6f0", textDecoration: "underline", textUnderlineOffset: 3 }}>eric@getsanction.com</a>.
            </p>
          </CxReveal>
        </div>
      </section>


      {/* Services — glyph cards on soft graph paper */}
      <section id="services" className="cx-graph-soft" style={{ borderTop: "1px solid transparent" }}>
        <div style={{ ...wrap, padding: "96px 32px" }}>
        <CxReveal style={{ maxWidth: 620, margin: "0 auto 48px", textAlign: "center" }}>
          <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>
            Four ways in. Every one leads somewhere.
          </h2>
          <p style={{ fontSize: 15.5, color: "var(--text-secondary)", margin: "14px 0 0" }}>
            Start with one concrete build. The first one pays for the next.
          </p>
        </CxReveal>
        <div className="sn-cards" style={{ gridTemplateColumns: "repeat(2,1fr)" }}>
          {SERVICES.map(({ key, title, body }, idx) => (
            <CxReveal key={key} delay={idx * 70}>
              <div className="sn-card cx-lift" style={{ padding: 28, display: "flex", gap: 18, alignItems: "flex-start", height: "100%" }}>
                <span style={{ flex: "none", width: 42, height: 42, borderRadius: 10, background: idx % 2 ? "var(--pine-tint)" : "var(--ochre-tint)", color: idx % 2 ? "var(--pine-7)" : "var(--ochre-7)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {SERVICE_GLYPHS[key]}
                </span>
                <span>
                  <h3 style={{ margin: "0 0 8px", font: "var(--text-h3)" }}>{title}</h3>
                  <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: "var(--text-secondary)" }}>{body}</p>
                </span>
              </div>
            </CxReveal>
          ))}
        </div>

        {/* Also in the kit — open row, diamond markers */}
        <CxReveal style={{ maxWidth: 620, margin: "72px auto 28px", textAlign: "center" }}>
          <h3 style={{ margin: 0, font: "var(--text-h2)", letterSpacing: "var(--tracking-heading)" }}>Also in the kit</h3>
        </CxReveal>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 36 }}>
          {ALSO.map(([t, d], idx) => (
            <CxReveal key={t} delay={idx * 80}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
                <span aria-hidden style={{ color: "var(--ochre-6)", fontSize: 11 }}>◆</span>
                <h4 style={{ margin: 0, font: "var(--text-h3)" }}>{t}</h4>
              </div>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "var(--text-secondary)", paddingLeft: 21 }}>{d}</p>
            </CxReveal>
          ))}
        </div>

        {/* What I won't do — ochre fence */}
        <CxReveal delay={100} style={{ maxWidth: 760, margin: "64px auto 0" }}>
          <div style={{ padding: "30px 34px", borderRadius: "var(--radius-card)", background: "var(--ochre-tint)", borderLeft: "4px solid var(--ochre-6)" }}>
            <h3 style={{ margin: "0 0 16px", font: "var(--text-h3)", color: "var(--ochre-7)" }}>What I won&apos;t do</h3>
            <div style={{ display: "grid", gap: 12 }}>
              {WONT.map((w) => (
                <div key={w} style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
                  <span aria-hidden style={{ color: "var(--ochre-7)", fontWeight: 700 }}>—</span>
                  <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: "var(--text-body)" }}>{w}</p>
                </div>
              ))}
            </div>
          </div>
        </CxReveal>
        </div>
      </section>



      {/* Founder */}
      <section style={{ ...wrap, padding: "96px 32px", maxWidth: 720, textAlign: "center" }}>
        <CxReveal>
          <img
            src="/brand/eric-lovold.jpg"
            alt="Eric Lovold"
            style={{ width: 180, maxWidth: "60%", height: "auto", display: "block", margin: "0 auto", borderRadius: "var(--radius-card)", border: "1px solid var(--line-1)" }}
          />
          <div style={{ margin: "16px 0 20px", fontSize: 14, color: "var(--text-secondary)" }}>Eric Lovold · Founder, Sanction AI</div>
          <p style={{ fontSize: 16, lineHeight: 1.65, color: "var(--text-secondary)", margin: 0 }}>
            I&apos;ve spent over a decade driving outcomes in healthcare and technology, and the last stretch running a
            solo AI practice and building Sanction. I&apos;ve been deep in this space, and talking AI is one of my
            favorite things to do.
          </p>
          <Link className="sanction-link" href="/about" style={{ display: "inline-block", marginTop: 16, color: "var(--pine-7)", fontWeight: 600 }}>
            More about Eric →
          </Link>
        </CxReveal>
      </section>


      {/* Footer */}
      <footer style={{ borderTop: "1px solid var(--line-2)" }}>
        <div style={{ ...wrap, display: "flex", alignItems: "center", gap: 24, padding: 32, fontSize: 13, color: "var(--text-muted)", flexWrap: "wrap" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, color: "var(--text-body)" }}>
            <img src="/brand/sanction-mark.svg" alt="" style={{ width: 18, height: 18 }} />
            Sanction
          </span>
          <span>Authorize · Protect · Govern</span>
          <span style={{ marginLeft: "auto", display: "flex", gap: 20 }}>
            <Link className="sanction-link" href="/">Product</Link>
            <Link className="sanction-link" href="/about">About</Link>
            <Link className="sanction-link" href="/docs">Docs</Link>
          </span>
        </div>
      </footer>
    </main>
  )
}
