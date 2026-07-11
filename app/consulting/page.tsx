import type { Metadata } from "next"
import Link from "next/link"
import "../brand.css"
import { brandFontVars } from "../brand-fonts"

export const metadata: Metadata = {
  title: "AI Consulting — Eric Lovold | Working AI for real businesses",
  description:
    "Eric Lovold installs working AI on real business workflows: implementation, internal tools, content systems, and coaching for SMBs and regulated teams. Discovery is free, and you'll leave with ideas either way.",
}

// Discovery Calendly. NEXT_PUBLIC_CALENDLY_URL overrides at build time.
const CALENDLY_URL =
  process.env.NEXT_PUBLIC_CALENDLY_URL || "https://calendly.com/eric-getsanction/discover"

const wrap: React.CSSProperties = { maxWidth: 1120, margin: "0 auto", padding: "0 32px" }

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
  [
    "You're worried about what AI does with your data",
    "You should be. Customer data ending up in tools, wrong answers reaching clients, nothing you could show an auditor. Those are solvable problems when you design for them from day one.",
  ],
]

const PHILOSOPHY: [string, string][] = [
  [
    "I meet you where you are.",
    "We start with your actual workflows and this month's actual problems, and we put working AI on the highest-leverage one first.",
  ],
  [
    "I build with your team.",
    "I map workflow opportunities alongside my clients, and your people are in the room. The point is that they understand what got built and why.",
  ],
  [
    "I leave you running it.",
    "The engagement ends with your team operating the system without me. If you keep me around, it's because the value keeps compounding.",
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

/* Pricing rungs. Dollar bands can be added to the price field when Eric sets them. */
const PRICING: { name: string; price: string; detail: string; accent: string }[] = [
  {
    name: "First build",
    price: "Fixed quote",
    detail: "One scoped system, quoted exactly after the free look and before any work starts.",
    accent: "var(--pine-8)",
  },
  {
    name: "Build + run",
    price: "Monthly",
    detail: "I operate and improve what we built, monthly. Your team learns it as we go. Cancel anytime.",
    accent: "var(--ochre-6)",
  },
  {
    name: "Embedded",
    price: "Quarterly retainer",
    detail: "Your fractional AI operator: a set number of days per month inside your business, shipping and teaching.",
    accent: "var(--pine-8)",
  },
]

const THREE_QUESTIONS: [string, string, string][] = [
  ["Q1", "Where does our data go?", "Every tool and workflow gets an answer you could give a client or an auditor."],
  ["Q2", "What happens when it's wrong?", "AI fails quietly and confidently. Everything I ship has a human checkpoint where wrong answers get caught."],
  ["Q3", "Who can turn it off?", "You. Always. Nothing runs that your team can't see, pause, or kill."],
]

const css = `
@keyframes cxUp { to { opacity: 1; transform: none } }
.cx-fade { opacity: 0; transform: translateY(14px); animation: cxUp .7s cubic-bezier(.2,.7,.2,1) forwards }
.cx-d1 { animation-delay: .05s } .cx-d2 { animation-delay: .15s } .cx-d3 { animation-delay: .25s }
.cx-d4 { animation-delay: .35s } .cx-d5 { animation-delay: .45s }
.cx-lift { transition: transform .25s ease, box-shadow .25s ease, border-color .25s ease }
.cx-lift:hover { transform: translateY(-4px); box-shadow: 0 14px 34px rgba(22,24,15,.10); border-color: var(--pine-6) }
@keyframes cxPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(16,185,129,.35) } 55% { box-shadow: 0 0 0 7px rgba(16,185,129,0) } }
.cx-dot { animation: cxPulse 2.2s ease-in-out infinite }
.cx-steps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 28px; position: relative }
.cx-steps::before { content: ""; position: absolute; top: 23px; left: 40px; right: 40px; height: 2px;
  background: linear-gradient(90deg, var(--pine-6), var(--ochre-6), var(--pine-6)); opacity: .35 }
@media (max-width: 900px) {
  .cx-steps { grid-template-columns: 1fr }
  .cx-steps::before { display: none }
}
@media (prefers-reduced-motion: reduce) {
  .cx-fade { animation: none; opacity: 1; transform: none }
  .cx-dot { animation: none }
  .cx-lift, .cx-lift:hover { transition: none; transform: none }
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
              Book free discovery
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
          <div className="sn-mono cx-fade cx-d1" style={{ letterSpacing: "0.1em" }}>
            AI CONSULTING · ERIC LOVOLD
          </div>
          <h1 className="cx-fade cx-d2" style={{ margin: "20px 0 0", font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>
            Let&apos;s put AI to work for your business.
          </h1>
          <div className="cx-fade cx-d4" style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 28, flexWrap: "wrap" }}>
            <a className="sn-btn sn-btn-primary sn-btn-l" href={CALENDLY_URL} target="_blank" rel="noopener">
              Book free discovery →
            </a>
            <a className="sn-btn sn-btn-l" href="#how" style={{ border: "1px solid var(--line-1)", background: "var(--surface-card)" }}>
              How it works
            </a>
          </div>
        </div>
        {/* Who I work with */}
        <div style={{ ...wrap, padding: "8px 32px 72px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center" }}>
            {["Healthcare & benefits", "Financial services", "Insurance", "Real estate", "Professional services", "Lean teams everywhere"].map((i, idx) => (
              <span key={i} className="sn-mono" style={{ color: idx % 2 ? "var(--ochre-7)" : "var(--pine-7)", borderRadius: "var(--radius-pill)", padding: "8px 16px", letterSpacing: "0.08em", background: idx % 2 ? "var(--ochre-tint)" : "var(--pine-tint)" }}>
                {i}
              </span>
            ))}
          </div>
        </div>
      </header>

      {/* The path — connected timeline, leads the page */}
      <section id="how" style={{ borderTop: "1px solid var(--line-2)", background: "var(--surface-sunken)" }}>
        <div style={{ ...wrap, padding: "88px 32px" }}>
          <div style={{ maxWidth: 620, margin: "0 auto 56px", textAlign: "center" }}>
            <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>
              A clear path from &ldquo;we should be using AI&rdquo; to &ldquo;we are.&rdquo;
            </h2>
          </div>
          <div className="cx-steps">
            {STEPS.map(([n, t, d], idx) => (
              <div key={n} style={{ position: "relative" }}>
                <div style={{ width: 48, height: 48, borderRadius: "50%", background: idx % 2 ? "var(--ochre-6)" : "var(--pine-8)", color: "#fdfcf8", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: 17, position: "relative", zIndex: 1, border: "4px solid var(--paper-1)" }}>
                  {n}
                </div>
                <h3 style={{ margin: "18px 0 8px", font: "var(--text-h3)" }}>{t}</h3>
                <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "var(--text-secondary)" }}>{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>


      {/* Philosophy — open editorial columns, then the dark receipts panel */}
      <section style={{ ...wrap, padding: "96px 32px 88px" }}>
        <div style={{ maxWidth: 620, margin: "0 auto 56px", textAlign: "center" }}>
          <div className="sn-mono" style={{ marginBottom: 16 }}>Why work with me</div>
          <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>
            Built with you. Run by you.
          </h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 40 }}>
          {PHILOSOPHY.map(([t, d], idx) => (
            <div key={t} style={{ borderLeft: `2px solid ${idx === 1 ? "var(--ochre-6)" : "var(--pine-6)"}`, paddingLeft: 22 }}>
              <h3 style={{ margin: "0 0 10px", font: "var(--text-h3)" }}>{t}</h3>
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.65, color: "var(--text-secondary)" }}>{d}</p>
            </div>
          ))}
        </div>
        {/* Receipts — dark pine panel */}
        <div style={{ maxWidth: 780, margin: "64px auto 0", padding: "36px 40px", borderRadius: "var(--radius-card)", background: "var(--pine-9)", color: "#f7f6f0" }}>
          <div className="sn-mono" style={{ color: "var(--ochre-6)", marginBottom: 14, letterSpacing: "0.1em" }}>The receipts</div>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.7 }}>
            I built <Link className="sanction-link" href="/" style={{ color: "#f7f6f0", fontWeight: 600, textDecoration: "underline", textUnderlineOffset: 4 }}>Sanction</Link>, a
            SaaS governance platform for AI agents that is{" "}
            <span style={{ whiteSpace: "nowrap" }}>
              <span className="cx-dot" style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "var(--signal)", marginRight: 7, verticalAlign: "2px" }} />
              in production today
            </span>
            . I run my own operation on the same systems I build for clients. Before that, over a decade in
            healthcare and technology, including years alongside benefits and claims operations.
          </p>
        </div>
      </section>

      {/* Final CTA — deep pine band */}
      <section
        id="book"
        style={{
          backgroundImage: "radial-gradient(90% 120% at 50% 115%, var(--pine-7) 0%, var(--pine-9) 68%)",
          color: "#f7f6f0",
        }}
      >
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "96px 32px", textAlign: "center" }}>
          <div className="sn-mono" style={{ marginBottom: 16, color: "var(--ochre-6)", letterSpacing: "0.1em" }}>Start here</div>
          <h2 style={{ margin: 0, font: "var(--text-h2)", letterSpacing: "var(--tracking-heading)", color: "#f7f6f0" }}>
            Not sure where AI fits your business? Let&apos;s find out. The first look is free.
          </h2>
          <p style={{ fontSize: 16, lineHeight: 1.6, color: "rgba(247,246,240,.75)", margin: "12px 0 28px" }}>
            Thirty minutes. You&apos;ll leave with ideas you can use whether we ever work together or not.
          </p>
          <a className="sn-btn sn-btn-l" href={CALENDLY_URL} target="_blank" rel="noopener" style={{ background: "#f7f6f0", color: "var(--pine-9)", fontWeight: 600 }}>
            Book free discovery →
          </a>
          <p style={{ fontSize: 13.5, color: "rgba(247,246,240,.6)", marginTop: 16 }}>
            Or email <a href="mailto:eric@getsanction.com" style={{ color: "#f7f6f0", textDecoration: "underline", textUnderlineOffset: 3 }}>eric@getsanction.com</a>. I reply within one business day.
          </p>
        </div>
      </section>

      {/* You might be here because — numbered attention cards */}
      <section style={{ borderTop: "1px solid var(--line-2)" }}>
        <div style={{ ...wrap, padding: "88px 32px" }}>
          <div style={{ maxWidth: 620, margin: "0 auto 48px", textAlign: "center" }}>
            <div className="sn-mono" style={{ marginBottom: 16, color: "var(--ochre-7)" }}>Sound familiar?</div>
            <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>
              You might be here because&hellip;
            </h2>
            <p style={{ fontSize: 15.5, color: "var(--text-secondary)", margin: "14px 0 0" }}>
              All of these are more common than you think. All of them are fixable.
            </p>
          </div>
          <div className="sn-cards" style={{ gridTemplateColumns: "repeat(2,1fr)" }}>
            {PAIN_POINTS.map(([t, d], i) => (
              <div key={t} className="sn-card cx-lift" style={{ padding: 28, borderTop: "3px solid var(--ochre-6)" }}>
                <div className="sn-mono" style={{ color: "var(--ochre-7)", marginBottom: 10 }}>{`0${i + 1}`}</div>
                <h3 style={{ margin: "0 0 8px", font: "var(--text-h3)" }}>{t}</h3>
                <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: "var(--text-secondary)" }}>{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>


      {/* Services — glyph cards */}
      <section id="services" style={{ ...wrap, padding: "96px 32px" }}>
        <div style={{ maxWidth: 620, margin: "0 auto 48px", textAlign: "center" }}>
          <div className="sn-mono" style={{ marginBottom: 16 }}>What I do</div>
          <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>
            Four ways in. Every one leads somewhere.
          </h2>
          <p style={{ fontSize: 15.5, color: "var(--text-secondary)", margin: "14px 0 0" }}>
            Start with one concrete build. The first one pays for the next.
          </p>
        </div>
        <div className="sn-cards" style={{ gridTemplateColumns: "repeat(2,1fr)" }}>
          {SERVICES.map(({ key, title, body }, idx) => (
            <div key={key} className="sn-card cx-lift" style={{ padding: 28, display: "flex", gap: 18, alignItems: "flex-start" }}>
              <span style={{ flex: "none", width: 42, height: 42, borderRadius: 10, background: idx % 2 ? "var(--pine-tint)" : "var(--ochre-tint)", color: idx % 2 ? "var(--pine-7)" : "var(--ochre-7)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {SERVICE_GLYPHS[key]}
              </span>
              <span>
                <h3 style={{ margin: "0 0 8px", font: "var(--text-h3)" }}>{title}</h3>
                <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: "var(--text-secondary)" }}>{body}</p>
              </span>
            </div>
          ))}
        </div>

        {/* Also in the kit — open row, diamond markers */}
        <div style={{ maxWidth: 620, margin: "72px auto 28px", textAlign: "center" }}>
          <h3 style={{ margin: 0, font: "var(--text-h2)", letterSpacing: "var(--tracking-heading)" }}>Also in the kit</h3>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 36 }}>
          {ALSO.map(([t, d]) => (
            <div key={t}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
                <span aria-hidden style={{ color: "var(--ochre-6)", fontSize: 11 }}>◆</span>
                <h4 style={{ margin: 0, font: "var(--text-h3)" }}>{t}</h4>
              </div>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "var(--text-secondary)", paddingLeft: 21 }}>{d}</p>
            </div>
          ))}
        </div>

        {/* What I won't do — ochre fence */}
        <div style={{ maxWidth: 760, margin: "64px auto 0", padding: "30px 34px", borderRadius: "var(--radius-card)", background: "var(--ochre-tint)", borderLeft: "4px solid var(--ochre-6)" }}>
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
      </section>



      {/* Recent work */}
      <section style={{ borderTop: "1px solid var(--line-2)", background: "var(--surface-sunken)" }}>
        <div style={{ ...wrap, padding: "88px 32px", maxWidth: 760, textAlign: "center" }}>
          <div className="sn-mono" style={{ marginBottom: 16 }}>Recent work</div>
          <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>
            Real work, shown with real consent.
          </h2>
          <p style={{ fontSize: 15.5, lineHeight: 1.65, color: "var(--text-secondary)", margin: "16px auto 0", maxWidth: "58ch" }}>
            Client case studies appear here only after clients say yes: situation, what was built, what it changed,
            and what the team runs on their own now.
          </p>
          {/* [CASE STUDIES: True North Co. Bookkeeping (pending Kelley's consent) + second study — Eric writes the four beats] */}
        </div>
      </section>

      {/* Founder */}
      <section style={{ ...wrap, padding: "96px 32px", maxWidth: 720, textAlign: "center" }}>
        <img
          src="/brand/eric-lovold.jpg"
          alt="Eric Lovold"
          style={{ width: 180, maxWidth: "60%", height: "auto", display: "block", margin: "0 auto", borderRadius: "var(--radius-card)", border: "1px solid var(--line-1)" }}
        />
        <div className="sn-mono" style={{ margin: "16px 0 20px", letterSpacing: "0.1em" }}>Eric Lovold · Founder, Sanction AI</div>
        <p style={{ fontSize: 16, lineHeight: 1.65, color: "var(--text-secondary)", margin: 0 }}>
          I&apos;ve spent over a decade driving outcomes in healthcare and technology, and the last stretch running a
          solo AI practice and building Sanction. I&apos;ve been deep in this space, and talking AI is one of my
          favorite things to do.
        </p>
        <Link className="sanction-link" href="/about" style={{ display: "inline-block", marginTop: 16, color: "var(--pine-7)", fontWeight: 600 }}>
          More about Eric →
        </Link>
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
