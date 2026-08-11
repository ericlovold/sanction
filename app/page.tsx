import type { Metadata } from "next"
import Link from "next/link"
import { AnthropicCerts } from "@/components/anthropic-certs"
import "./brand.css"
import { brandFontVars } from "./brand-fonts"

// Repositioned 2026-08 (Jim Keen conversation): getsanction.com now leads as
// Sanction AI — the services company — with the products as proof of
// capability. The product marketing page moved intact to /platform; nothing
// under /dashboard, /docs, or /api changed. ericlovold.com stays the personal
// vehicle (newsletter, story); this site is the firm work is delivered under.

// Discovery booking — same live Calendly the personal site uses.
// NEXT_PUBLIC_CALENDLY_URL overrides at build time.
const CALENDLY_URL =
  process.env.NEXT_PUBLIC_CALENDLY_URL || "https://calendly.com/ericlovold/30min"

export const metadata: Metadata = {
  title: "Sanction AI — AI advisory and implementation for real businesses",
  description:
    "Sanction AI installs working AI on real business workflows: implementation, internal tools, content systems, and executive strategy. Discovery is free — you leave with the start of a plan either way.",
}

const structuredData = {
  "@context": "https://schema.org",
  "@type": "ProfessionalService",
  name: "Sanction AI",
  url: "https://getsanction.com",
  description:
    "AI advisory and implementation. Working systems installed on real business workflows — plus production AI products: the Sanction authorization platform and the Moral Intention Analyst.",
}

function MonoLabel({ children, color, mt, mb }: { children: React.ReactNode; color?: string; mt?: number; mb?: number }) {
  return (
    <div className="sn-mono" style={{ color, marginTop: mt, marginBottom: mb }}>
      {children}
    </div>
  )
}

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
]

const SERVICES: [string, string][] = [
  [
    "The morning that runs itself",
    "Intake, follow-ups, reporting, the recurring hours — wired to run on their own. You review the exceptions; you stop retyping.",
  ],
  [
    "The app that's in your head",
    "The internal tool your team's wanted for years, now cheap enough to actually build with AI. Scoped, shipped, dependable in production.",
  ],
  [
    "Faster, still unmistakably you",
    "Drafting, structuring, repurposing at speed — tuned so everything that ships still reads like your company wrote it.",
  ],
  [
    "Live in weeks, not quarters",
    "A modern site — designed, written with you, instrumented, shipped AI-fast. The same way we built this one.",
  ],
]

const STEPS: [string, string, string][] = [
  [
    "1",
    "A real conversation",
    "A free discovery call about your goals and where you are. You'll walk away with an honest read and the start of a plan, whether we work together or not.",
  ],
  [
    "2",
    "A look at your workflows",
    "We map where the hours actually go and where AI removes friction, measured against real outcomes. You get the map either way.",
  ],
  [
    "3",
    "A first build with a fixed scope",
    "One concrete thing, priced exactly before any work starts. A workflow that runs itself, an internal tool, a content system. Your team puts its hands on it in weeks.",
  ],
  [
    "4",
    "A simple ongoing rhythm",
    "Keep building monthly, or have us embedded a few days a month as your fractional AI operator.",
  ],
]

const WONT: string[] = [
  "Sell you “transformation.” You'll get specific systems with names, owners, and measured outcomes.",
  "Automate your voice away. Anything a human reads as you stays written by you. AI makes you faster.",
  "Ship anything you can't see into. If it touches your data or your customers, you can audit what it did and turn it off.",
  "Build dependency. If you can't run it without us when we leave, we haven't finished the job.",
]

export default function Landing() {
  return (
    <main className={`sanction ${brandFontVars}`} style={{ minHeight: "100vh" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />

      {/* Launch ribbon — MIA showtime window. Remove after the launch cycle. */}
      <Link
        href="/moral-intention"
        style={{
          display: "block",
          background: "var(--pine-9)",
          color: "#EDE9DC",
          textAlign: "center",
          padding: "10px 16px",
          fontSize: 13.5,
          letterSpacing: "0.01em",
        }}
      >
        <span className="sn-mono" style={{ color: "#78E0B2", letterSpacing: "0.1em", marginRight: 10 }}>NEW</span>
        Moral Intention Analyst — ethical analysis of documents, decisions, and processes. Try it free →
      </Link>

      {/* Nav */}
      <nav style={{ position: "sticky", top: 0, zIndex: 40, background: "rgba(251,250,246,.8)", backdropFilter: "blur(12px)", borderBottom: "1px solid var(--line-2)" }}>
        <div style={{ ...wrap, display: "flex", alignItems: "center", gap: 32, height: 64 }}>
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 600, fontSize: 17, letterSpacing: "-0.02em" }}>
            <img src="/brand/sanction-mark.svg" alt="" style={{ width: 24, height: 24 }} />
            Sanction AI
          </Link>
          <div className="sn-nav-links" style={{ display: "flex", gap: 24, fontSize: 14, marginLeft: 16, whiteSpace: "nowrap" }}>
            <a className="sanction-link" href="#services">Services</a>
            <a className="sanction-link" href="#how">How we work</a>
            <a className="sanction-link" href="#built">What we&apos;ve built</a>
            <Link className="sanction-link" href="/docs">Docs</Link>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
            <Link className="sn-btn sn-btn-ghost sn-btn-s" href="/login">Sign in</Link>
            <a className="sn-btn sn-btn-primary sn-btn-s" href={CALENDLY_URL} target="_blank" rel="noopener">
              Book discovery
            </a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <header className="sn-pad" style={{ ...wrap, padding: "104px 32px 96px", maxWidth: 880 }}>
        <MonoLabel mb={20}>AI advisory · Implementation · Products</MonoLabel>
        <h1 className="sn-hero-h1" style={{ margin: 0, font: "var(--text-display)", letterSpacing: "var(--tracking-display)" }}>
          Working AI for real businesses.
        </h1>
        <p style={{ font: "var(--text-body-l)", color: "var(--text-secondary)", maxWidth: "52ch", margin: "24px 0 32px" }}>
          We install AI on the workflows your business already runs — implementation, internal
          tools, content systems, and executive strategy. Built inside the tools you already pay
          for, measured against outcomes you can point to.
        </p>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <a className="sn-btn sn-btn-primary sn-btn-l" href={CALENDLY_URL} target="_blank" rel="noopener">
            Book a free discovery call
          </a>
          <a className="sn-btn sn-btn-secondary sn-btn-l" href="#built">See what we&apos;ve built →</a>
        </div>
        <MonoLabel mt={28} color="var(--text-faint)">
          Discovery is free. You leave with the start of a plan either way.
        </MonoLabel>
      </header>

      <AnthropicCerts />

      {/* Why companies call */}
      <section style={{ ...wrap, padding: "96px 32px 112px" }}>
        <div style={{ maxWidth: 620, marginBottom: 48 }}>
          <MonoLabel mb={16}>Why companies call</MonoLabel>
          <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>
            The work is sitting there. The hire isn&apos;t coming.
          </h2>
        </div>
        <div className="sn-cards">
          {PAIN_POINTS.map(([t, d]) => (
            <div key={t} style={{ borderTop: "1px solid var(--line-1)", paddingTop: 20 }}>
              <h3 style={{ margin: "0 0 8px", font: "var(--text-h3)" }}>{t}</h3>
              <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55, color: "var(--text-secondary)" }}>{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Services */}
      <section id="services" style={{ borderTop: "1px solid var(--line-2)", background: "var(--surface-sunken)" }}>
        <div style={{ ...wrap, padding: "96px 32px 112px" }}>
          <div style={{ maxWidth: 620, marginBottom: 48 }}>
            <MonoLabel mb={16}>Services</MonoLabel>
            <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>
              What you end up with.
            </h2>
            <p style={{ font: "var(--text-body-l)", color: "var(--text-secondary)", maxWidth: "54ch", margin: "20px 0 0" }}>
              Not a strategy deck. Working systems, running in production, with your team trained
              on the handoff.
            </p>
          </div>
          <div className="sn-pair">
            {SERVICES.map(([t, d]) => (
              <div key={t} className="sn-card" style={{ padding: 28 }}>
                <h3 style={{ margin: "0 0 8px", font: "var(--text-h3)" }}>{t}</h3>
                <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55, color: "var(--text-secondary)" }}>{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How we work */}
      <section id="how" style={{ ...wrap, padding: "112px 32px" }}>
        <div style={{ maxWidth: 620, marginBottom: 48 }}>
          <MonoLabel mb={16}>How we work</MonoLabel>
          <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>
            Four steps, no mystery.
          </h2>
        </div>
        <div className="sn-pair">
          {STEPS.map(([n, t, d]) => (
            <div key={n} style={{ borderTop: "1px solid var(--line-1)", paddingTop: 20 }}>
              <MonoLabel color="var(--pine-7)">{n}</MonoLabel>
              <h3 style={{ margin: "10px 0 8px", font: "var(--text-h3)" }}>{t}</h3>
              <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55, color: "var(--text-secondary)" }}>{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Built by us — the products as proof */}
      <section id="built" data-theme="dark" style={{ background: "#0A0A0A" }}>
        <div style={{ ...wrap, padding: "96px 32px 104px" }}>
          <div style={{ maxWidth: 620, marginBottom: 48 }}>
            <MonoLabel color="#2CC08D" mb={16}>What we&apos;ve built</MonoLabel>
            <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)", color: "#F2F1EA" }}>
              We run production AI. That&apos;s why we can install it.
            </h2>
            <p style={{ fontSize: 16, lineHeight: 1.6, color: "#C4C7BB", maxWidth: "54ch", margin: "20px 0 0" }}>
              The advice comes from operating real systems with real users — not from slides.
            </p>
          </div>
          <div className="sn-pair">
            <div style={{ background: "#141513", border: "1px solid rgba(242,241,234,.1)", borderRadius: 14, padding: 28 }}>
              <MonoLabel color="#2CC08D">Moral Intention Analyst</MonoLabel>
              <h3 style={{ margin: "12px 0 8px", font: "var(--text-h3)", color: "#F2F1EA" }}>
                Ethical analysis of documents, decisions, and processes
              </h3>
              <p style={{ margin: "0 0 20px", fontSize: 14.5, lineHeight: 1.55, color: "#C4C7BB" }}>
                Authored with Dr. A.C. Ping, PhD. Bring it a contract, a policy, a decision you&apos;re
                weighing — it surfaces what&apos;s at stake, who&apos;s affected, and where the reasoning
                drifts. Built for the calls a person has to make. Free to try.
              </p>
              <Link className="sn-btn sn-btn-onDark sn-btn-m" href="/moral-intention">Try the analyst →</Link>
            </div>
            <div style={{ background: "#141513", border: "1px solid rgba(242,241,234,.1)", borderRadius: 14, padding: 28 }}>
              <MonoLabel color="#2CC08D">Sanction Platform</MonoLabel>
              <h3 style={{ margin: "12px 0 8px", font: "var(--text-h3)", color: "#F2F1EA" }}>
                Authorization for autonomous AI agents
              </h3>
              <p style={{ margin: "0 0 20px", fontSize: 14.5, lineHeight: 1.55, color: "#C4C7BB" }}>
                Budgets, human sign-off, and a signed audit trail for what agents spend and do.
                Live in production — REST, AWS Bedrock, and MCP.
              </p>
              <Link className="sn-btn sn-btn-onDark sn-btn-m" href="/platform">Explore the platform →</Link>
            </div>
          </div>
        </div>
      </section>

      {/* What we won't do */}
      <section style={{ ...wrap, padding: "112px 32px" }}>
        <div style={{ maxWidth: 620, marginBottom: 40 }}>
          <MonoLabel mb={16}>The other side of the deal</MonoLabel>
          <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>
            What we won&apos;t do.
          </h2>
        </div>
        <div className="sn-pair">
          {WONT.map((t) => (
            <div key={t} style={{ borderTop: "1px solid var(--line-1)", paddingTop: 16 }}>
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: "var(--text-secondary)" }}>{t}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Closing CTA */}
      <section style={{ borderTop: "1px solid var(--line-2)", background: "var(--surface-sunken)" }}>
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "88px 32px", textAlign: "center" }}>
          <MonoLabel mb={16}>First conversation</MonoLabel>
          <h2 style={{ margin: 0, font: "var(--text-h2)", letterSpacing: "var(--tracking-heading)" }}>
            Bring the workflow that&apos;s eating your week.
          </h2>
          <p style={{ fontSize: 16, lineHeight: 1.6, color: "var(--text-secondary)", margin: "12px 0 28px" }}>
            One free call. You&apos;ll walk out with the start of a plan, whether or not we work
            together.
          </p>
          <a className="sn-btn sn-btn-primary sn-btn-l" href={CALENDLY_URL} target="_blank" rel="noopener">
            Book a free discovery call
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ borderTop: "1px solid var(--line-2)" }}>
        <div style={{ ...wrap, display: "flex", alignItems: "center", gap: 24, padding: 32, fontSize: 13, color: "var(--text-muted)", flexWrap: "wrap" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, color: "var(--text-body)" }}>
            <img src="/brand/sanction-mark.svg" alt="" style={{ width: 18, height: 18 }} />
            Sanction AI
          </span>
          <span>Advisory · Implementation · Products</span>
          <span style={{ marginLeft: "auto", display: "flex", gap: 20, flexWrap: "wrap" }}>
            <Link className="sanction-link" href="/platform">Platform</Link>
            <Link className="sanction-link" href="/moral-intention">Moral Intention</Link>
            <Link className="sanction-link" href="/about">About</Link>
            <Link className="sanction-link" href="/roadmap">Roadmap</Link>
            <Link className="sanction-link" href="/changelog">Changelog</Link>
            <a className="sanction-link" href="/api/openapi.json">API</a>
            <a className="sanction-link" href="https://www.npmjs.com/package/sanction-mcp">MCP</a>
          </span>
        </div>
      </footer>
    </main>
  )
}
