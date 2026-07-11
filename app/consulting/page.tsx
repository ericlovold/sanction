import type { Metadata } from "next"
import Link from "next/link"
import "../brand.css"
import { brandFontVars } from "../brand-fonts"

export const metadata: Metadata = {
  title: "AI Consulting — Eric Lovold | Working AI for real businesses",
  description:
    "Eric Lovold installs working AI on real business workflows — implementation, internal tools, content systems, and coaching for SMBs and regulated teams. Discovery is free, and you'll leave with ideas either way.",
}

// Discovery Calendly. NEXT_PUBLIC_CALENDLY_URL overrides at build time.
const CALENDLY_URL =
  process.env.NEXT_PUBLIC_CALENDLY_URL || "https://calendly.com/eric-getsanction/discover"

const wrap: React.CSSProperties = { maxWidth: 1120, margin: "0 auto", padding: "0 32px" }

const PAIN_POINTS: [string, string][] = [
  [
    "You posted an AI role that isn't filling",
    "The person who can both build AI and understand your business is a unicorn — and the big tech companies pay them more than the role makes sense for. Meanwhile the work is still sitting there.",
  ],
  [
    "You tried the tools and nothing stuck",
    "Someone bought licenses, a few people experimented, the excitement faded. That isn't a failure of your team — it's what happens without someone who installs AI on the way you actually work.",
  ],
  [
    "Your team is at capacity and the asks keep coming",
    "You don't need more headcount to deliver more. You need the repetitive half of the work to run itself so your people spend their hours on the judgment work only they can do.",
  ],
  [
    "You're worried about what AI does with your data",
    "You should be. Customer data ending up in tools, wrong answers reaching clients, nothing you could show an auditor. Those are solvable problems — if someone designs for them from day one.",
  ],
]

const PHILOSOPHY: [string, string][] = [
  [
    "I meet you where you are.",
    "No prerequisite stack, no six-month roadmap before anything works. We start with your actual workflows, this month's actual problems, and put working AI on the highest-leverage one first.",
  ],
  [
    "I build with your team, not around it.",
    "I map workflow opportunities alongside my clients, and we work the right problems in real time. Your people are in the room — the point is that they understand what got built and why.",
  ],
  [
    "I leave you running it.",
    "The engagement ends with your team operating the system without me. If you keep me around, it's because the value compounds — never because you're dependent. That's the difference between a coach and a vendor.",
  ],
]

const STEPS: [string, string, string][] = [
  [
    "1",
    "A real conversation — free",
    "Thirty minutes of discovery about your goals and where you are. You'll walk away with my honest read and the ideas I'd run at first — either way, whether we work together or not.",
  ],
  [
    "2",
    "A free look at your workflows",
    "I map where the hours actually go and where AI removes friction — measured against real outcomes, not demos. You get the map regardless. No lectures, no pitch deck.",
  ],
  [
    "3",
    "A first build with a fixed scope",
    "One concrete thing, priced exactly before any work starts. A workflow that runs itself, an internal tool, a content system. Weeks, not quarters — something your team puts its hands on.",
  ],
  [
    "4",
    "A simple ongoing rhythm — if it earns it",
    "Keep building monthly, or have me embedded a few days a month as your fractional AI operator. Cancel anytime. The first build has to prove the value first.",
  ],
]

const SERVICES: [string, string][] = [
  [
    "AI workflows & setup",
    "Tools, automations, and guardrails installed on your team's real work — intake, follow-ups, reporting, the recurring hours. The morning that runs itself instead of starting in seventeen tabs.",
  ],
  [
    "Internal tools & apps",
    "The tool your team has wanted for years but could never justify a dev shop for. AI-built means SMB-affordable now — scoped, shipped, and dependable in production.",
  ],
  [
    "Content systems — in your voice",
    "AI never writes as you. It makes your team faster in your own voice — drafting, structuring, repurposing — so what ships still sounds like your company and not like everyone else's AI.",
  ],
  [
    "Websites that work",
    "A modern site built AI-fast: designed, written with you, instrumented, and live in weeks. The same way I build for my own company.",
  ],
]

const ALSO: [string, string][] = [
  [
    "Vet your AI hire",
    "A lot of companies find out five months in that their AI director can talk AI but can't ship it. I'll help you interview and evaluate candidates — before the salary bet, not after.",
  ],
  [
    "Executive coaching",
    "Direct 1:1 work on AI tools, workflows, and judgment for leaders. Practical and current, never theoretical.",
  ],
  [
    "Design sprints",
    "A focused week from problem to working prototype your team can evaluate with its own hands.",
  ],
]

const WONT: string[] = [
  "Sell you “transformation.” You'll get specific systems with names, owners, and measured outcomes.",
  "Automate your voice away. Anything a human reads as you stays written by you — AI makes you faster, not replaceable.",
  "Ship anything you can't see into. If it touches your data or your customers, you can audit what it did and turn it off.",
  "Build dependency. If you can't run it without me when I leave, I haven't finished the job.",
]

/* PRICING — ERIC SETS THE NUMBERS. Placeholders are intentional and must be
   replaced before this page ships. Structure mirrors the engagement ladder. */
const PRICING: { name: string; price: string; detail: string }[] = [
  {
    name: "First build",
    price: "[ERIC: fixed-quote range]",
    detail:
      "One scoped system, quoted exactly after the free look — before any work starts. No surprise bills, ever.",
  },
  {
    name: "Build + run",
    price: "[ERIC: monthly range]",
    detail:
      "I operate and improve what we built, monthly. Your team learns it as we go. Cancel anytime.",
  },
  {
    name: "Embedded",
    price: "[ERIC: retainer range]",
    detail:
      "Your fractional AI operator — a set number of days per month inside your business, shipping and teaching. Quarterly.",
  },
]

const THREE_QUESTIONS: [string, string][] = [
  ["Where does our data go?", "Every tool and workflow gets an answer you could give a client or an auditor."],
  ["What happens when it's wrong?", "AI fails quietly and confidently. Everything I ship has a human checkpoint where wrong answers get caught."],
  ["Who can turn it off?", "You. Always. Nothing runs that your team can't see, pause, or kill."],
]

export default function Consulting() {
  return (
    <main className={`sanction ${brandFontVars}`} style={{ minHeight: "100vh" }}>
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
            <a className="sanction-link" href="#pricing">Pricing</a>
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
      <header style={{ ...wrap, padding: "88px 32px 48px", maxWidth: 760, textAlign: "center" }}>
        <div className="sn-mono" style={{ marginBottom: 20, letterSpacing: "0.1em" }}>
          AI Consulting · Eric Lovold
        </div>
        <h1 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>
          Let&apos;s put AI to work for your business.
        </h1>
        <p style={{ font: "var(--text-body-l)", color: "var(--text-secondary)", margin: "24px auto 0", maxWidth: "58ch" }}>
          I&apos;m a solo AI practice for SMBs and regulated teams. I map workflow opportunities alongside my
          clients, we create solutions that stick, and your team ends up running them without me.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 32, flexWrap: "wrap" }}>
          <a className="sn-btn sn-btn-primary sn-btn-l" href={CALENDLY_URL} target="_blank" rel="noopener">
            Book free discovery →
          </a>
          <a className="sn-btn sn-btn-l" href="#how" style={{ border: "1px solid var(--line-1)" }}>
            How it works
          </a>
        </div>
        <p style={{ fontSize: 13.5, color: "var(--text-muted)", marginTop: 14 }}>
          Discovery is free. You&apos;ll leave with my honest read and real ideas — either way.
        </p>
      </header>

      {/* Who I work with */}
      <section style={{ ...wrap, padding: "8px 32px 80px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center" }}>
          {["Healthcare & benefits", "Financial services", "Insurance", "Real estate", "Agencies & studios", "Professional services", "Lean teams everywhere"].map((i) => (
            <span key={i} className="sn-mono" style={{ color: "var(--pine-7)", border: "1px solid var(--line-1)", borderRadius: "var(--radius-pill)", padding: "8px 16px", letterSpacing: "0.08em" }}>
              {i}
            </span>
          ))}
        </div>
      </section>

      {/* You might be here because */}
      <section style={{ borderTop: "1px solid var(--line-2)", background: "var(--surface-sunken)" }}>
        <div style={{ ...wrap, padding: "88px 32px" }}>
          <div style={{ maxWidth: 620, margin: "0 auto 48px", textAlign: "center" }}>
            <div className="sn-mono" style={{ marginBottom: 16 }}>Sound familiar?</div>
            <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>
              You might be here because&hellip;
            </h2>
            <p style={{ fontSize: 15.5, color: "var(--text-secondary)", margin: "14px 0 0" }}>
              All of these are more common than you think. All of them are fixable. No lectures.
            </p>
          </div>
          <div className="sn-cards" style={{ gridTemplateColumns: "repeat(2,1fr)" }}>
            {PAIN_POINTS.map(([t, d]) => (
              <div key={t} className="sn-card" style={{ padding: 28 }}>
                <h3 style={{ margin: "0 0 8px", font: "var(--text-h3)" }}>{t}</h3>
                <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: "var(--text-secondary)" }}>{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Philosophy */}
      <section style={{ ...wrap, padding: "96px 32px" }}>
        <div style={{ maxWidth: 620, margin: "0 auto 48px", textAlign: "center" }}>
          <div className="sn-mono" style={{ marginBottom: 16 }}>Why work with me</div>
          <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>
            Built with you. Run by you.
          </h2>
        </div>
        <div className="sn-cards" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
          {PHILOSOPHY.map(([t, d]) => (
            <div key={t} className="sn-card" style={{ padding: 28 }}>
              <h3 style={{ margin: "0 0 8px", font: "var(--text-h3)" }}>{t}</h3>
              <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: "var(--text-secondary)" }}>{d}</p>
            </div>
          ))}
        </div>
        {/* Receipts */}
        <div style={{ maxWidth: 720, margin: "48px auto 0", textAlign: "center", padding: 28, border: "1px solid var(--line-1)", borderRadius: "var(--radius-card)", background: "var(--surface-card)" }}>
          <p style={{ margin: 0, fontSize: 15.5, lineHeight: 1.65, color: "var(--text-secondary)" }}>
            The receipts: I built <Link className="sanction-link" href="/" style={{ color: "var(--pine-7)", fontWeight: 600 }}>Sanction</Link> — a
            production SaaS governance platform for AI agents — and I run my own operation on the same systems I
            build for clients. Before that, a decade in healthcare and technology, including years alongside
            benefits and claims operations.
          </p>
        </div>
      </section>

      {/* How it works */}
      <section id="how" style={{ borderTop: "1px solid var(--line-2)", background: "var(--surface-sunken)" }}>
        <div style={{ ...wrap, padding: "88px 32px" }}>
          <div style={{ maxWidth: 620, margin: "0 auto 48px", textAlign: "center" }}>
            <div className="sn-mono" style={{ marginBottom: 16 }}>How it works</div>
            <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>
              A clear path from &ldquo;we should be using AI&rdquo; to &ldquo;we are.&rdquo;
            </h2>
          </div>
          <div className="sn-cards" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
            {STEPS.map(([n, t, d]) => (
              <div key={n} className="sn-card" style={{ padding: 28 }}>
                <div className="sn-mono" style={{ color: "var(--pine-7)", marginBottom: 12 }}>{n}</div>
                <h3 style={{ margin: "0 0 8px", font: "var(--text-h3)" }}>{t}</h3>
                <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "var(--text-secondary)" }}>{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Services — the four doors */}
      <section id="services" style={{ ...wrap, padding: "96px 32px" }}>
        <div style={{ maxWidth: 620, margin: "0 auto 48px", textAlign: "center" }}>
          <div className="sn-mono" style={{ marginBottom: 16 }}>What I do</div>
          <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>
            Four ways in. Every one leads somewhere.
          </h2>
          <p style={{ fontSize: 15.5, color: "var(--text-secondary)", margin: "14px 0 0" }}>
            Start with one concrete build. Most clients keep going — because the first one pays for the next.
          </p>
        </div>
        <div className="sn-cards" style={{ gridTemplateColumns: "repeat(2,1fr)" }}>
          {SERVICES.map(([t, d]) => (
            <div key={t} className="sn-card" style={{ padding: 28 }}>
              <h3 style={{ margin: "0 0 8px", font: "var(--text-h3)" }}>{t}</h3>
              <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: "var(--text-secondary)" }}>{d}</p>
            </div>
          ))}
        </div>

        <div style={{ maxWidth: 620, margin: "64px auto 24px", textAlign: "center" }}>
          <h3 style={{ margin: 0, font: "var(--text-h2)", letterSpacing: "var(--tracking-heading)" }}>Also in the kit</h3>
        </div>
        <div className="sn-cards" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
          {ALSO.map(([t, d]) => (
            <div key={t} className="sn-card" style={{ padding: 24 }}>
              <h3 style={{ margin: "0 0 8px", font: "var(--text-h3)" }}>{t}</h3>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "var(--text-secondary)" }}>{d}</p>
            </div>
          ))}
        </div>

        {/* Honest exclusions */}
        <div style={{ maxWidth: 720, margin: "56px auto 0", padding: 28, border: "1px solid var(--line-1)", borderRadius: "var(--radius-card)", background: "var(--surface-card)" }}>
          <h3 style={{ margin: "0 0 14px", font: "var(--text-h3)" }}>What I won&apos;t do</h3>
          <ul style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 10 }}>
            {WONT.map((w) => (
              <li key={w} style={{ fontSize: 14.5, lineHeight: 1.6, color: "var(--text-secondary)" }}>{w}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* The three questions */}
      <section style={{ borderTop: "1px solid var(--line-2)", background: "var(--surface-sunken)" }}>
        <div style={{ ...wrap, padding: "88px 32px" }}>
          <div style={{ maxWidth: 660, margin: "0 auto 48px", textAlign: "center" }}>
            <div className="sn-mono" style={{ marginBottom: 16 }}>The standard</div>
            <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>
              Three questions every AI system has to answer.
            </h2>
            <p style={{ fontSize: 15.5, color: "var(--text-secondary)", margin: "14px 0 0" }}>
              Ask these of any AI hire or vendor — including me. If the answers are vague, walk.
            </p>
          </div>
          <div className="sn-cards" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
            {THREE_QUESTIONS.map(([q, a]) => (
              <div key={q} className="sn-card" style={{ padding: 28 }}>
                <h3 style={{ margin: "0 0 8px", font: "var(--text-h3)" }}>{q}</h3>
                <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: "var(--text-secondary)" }}>{a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" style={{ ...wrap, padding: "96px 32px" }}>
        <div style={{ maxWidth: 620, margin: "0 auto 48px", textAlign: "center" }}>
          <div className="sn-mono" style={{ marginBottom: 16 }}>Pricing</div>
          <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>
            An exact number before any work starts.
          </h2>
          <p style={{ fontSize: 15.5, color: "var(--text-secondary)", margin: "14px 0 0" }}>
            Discovery and the workflow look are free. Every build is quoted flat after that. No surprise bills, ever.
          </p>
        </div>
        <div className="sn-cards" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
          {PRICING.map(({ name, price, detail }) => (
            <div key={name} className="sn-card" style={{ padding: 28, textAlign: "center" }}>
              <div className="sn-mono" style={{ marginBottom: 12 }}>{name}</div>
              <div style={{ font: "var(--text-h2)", letterSpacing: "var(--tracking-heading)", marginBottom: 10 }}>{price}</div>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "var(--text-secondary)" }}>{detail}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Recent work — placeholder until consent + write-ups */}
      <section style={{ borderTop: "1px solid var(--line-2)", background: "var(--surface-sunken)" }}>
        <div style={{ ...wrap, padding: "88px 32px", maxWidth: 760, textAlign: "center" }}>
          <div className="sn-mono" style={{ marginBottom: 16 }}>Recent work</div>
          <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>
            Real work, shown with real consent.
          </h2>
          <p style={{ fontSize: 15.5, lineHeight: 1.65, color: "var(--text-secondary)", margin: "16px auto 0", maxWidth: "58ch" }}>
            Client case studies appear here only after clients say yes — situation, what was built, what it changed,
            and what the team runs on their own now. In the meantime, the standing proof is{" "}
            <Link className="sanction-link" href="/" style={{ color: "var(--pine-7)", fontWeight: 600 }}>Sanction</Link>:
            a production platform I designed, built, and operate.
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
          solo AI practice and building Sanction. I&apos;ve been deep in this space — and talking AI is one of my
          favorite things to do.
        </p>
        <Link className="sanction-link" href="/about" style={{ display: "inline-block", marginTop: 16, color: "var(--pine-7)", fontWeight: 600 }}>
          More about Eric →
        </Link>
      </section>

      {/* Final CTA */}
      <section id="book" style={{ borderTop: "1px solid var(--line-2)", background: "var(--surface-sunken)" }}>
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "88px 32px", textAlign: "center" }}>
          <div className="sn-mono" style={{ marginBottom: 16 }}>Start here</div>
          <h2 style={{ margin: 0, font: "var(--text-h2)", letterSpacing: "var(--tracking-heading)" }}>
            Not sure where AI fits your business? Let&apos;s find out. The first look is free.
          </h2>
          <p style={{ fontSize: 16, lineHeight: 1.6, color: "var(--text-secondary)", margin: "12px 0 28px" }}>
            Thirty minutes, no pitch, no pressure. You&apos;ll leave with ideas you can use whether we ever work together or not.
          </p>
          <a className="sn-btn sn-btn-primary sn-btn-l" href={CALENDLY_URL} target="_blank" rel="noopener">
            Book free discovery →
          </a>
          <p style={{ fontSize: 13.5, color: "var(--text-muted)", marginTop: 16 }}>
            Or email <a className="sanction-link" href="mailto:eric@getsanction.com" style={{ color: "var(--pine-7)" }}>eric@getsanction.com</a> — I reply within one business day.
          </p>
        </div>
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
