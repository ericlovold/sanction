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
    "Sanction AI builds operating systems for AI-enabled companies: implementation, internal tools, agent infrastructure, and executive strategy.",
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
    "Thirty minutes on your goals, current workflows, and the first system worth building.",
  ],
  [
    "2",
    "A look at your workflows",
    "We map where the hours go and where AI removes friction, measured against real outcomes.",
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

function WalletVisual() {
  return (
    <div className="sn-wallet-stage" aria-label="Sanction agent wallet and verified mandate">
      <div className="sn-wallet-orbit" aria-hidden="true" />
      <div className="sn-wallet-card">
        <div className="sn-wallet-card-top">
          <img src="/brand/sanction-mark.svg" alt="" />
          <span>AGENT WALLET</span>
          <span className="sn-wallet-live"><i /> LIVE</span>
        </div>
        <div className="sn-wallet-agent">ops_agent_07</div>
        <div className="sn-wallet-rule" />
        <div className="sn-wallet-stats">
          <div><span>POLICY</span><strong>production_ops</strong></div>
          <div><span>AVAILABLE</span><strong>$2,500.00</strong></div>
        </div>
        <div className="sn-wallet-foot">
          <span>pxy_•••••••3fa</span>
          <span>MCP · REST</span>
        </div>
      </div>
      <div className="sn-mandate-card">
        <div className="sn-mandate-top"><span>MANDATE</span><b>VERIFIED</b></div>
        <div className="sn-mandate-title">vendor_payment</div>
        <div className="sn-mandate-meta">
          <span>scope</span><strong>stripe.charge</strong>
          <span>cap</span><strong>$480.00</strong>
          <span>expires</span><strong>14m 32s</strong>
        </div>
        <div className="sn-mandate-proof"><i /> SIGNATURE + WALLET STATUS VALID</div>
      </div>
      <div className="sn-wallet-caption sn-mono">Policy travels with the agent</div>
    </div>
  )
}

const WALLET_FLOW: [string, string, string][] = [
  ["01", "Discover", "A counterparty finds the issuer and verification surface."],
  ["02", "Present", "The agent carries a signed, scoped, time-bound mandate."],
  ["03", "Verify", "The counterparty checks budget, scope, freeze, and revocation."],
  ["04", "Prove", "Each authorization becomes attributable evidence."],
]

function WalletFlow() {
  return (
    <div className="sn-flow" aria-label="Agent wallet lifecycle">
      {WALLET_FLOW.map(([n, title, body], index) => (
        <div className="sn-flow-step" key={title}>
          <div className="sn-flow-node">
            <span>{n}</span>
            {index < WALLET_FLOW.length - 1 && <i aria-hidden="true" />}
          </div>
          <h3>{title}</h3>
          <p>{body}</p>
        </div>
      ))}
    </div>
  )
}

export default function Landing() {
  return (
    <main className={`sanction ${brandFontVars}`} style={{ minHeight: "100vh" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />

      {/* Launch ribbon — MIA showtime window. Live since 2026-08-10; pull it
          after 2026-09-10 so the home page isn't permanently in launch mode.
          Tracked in docs/BACKLOG.md so the date doesn't rely on memory. */}
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
            <img src="/brand/sanction-wordmark-green.svg" alt="Sanction" style={{ height: 25 }} />
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
      <header className="sn-home-hero">
        <div className="sn-home-hero-grid" style={wrap}>
          <div>
            <MonoLabel mb={20}>AI systems · Agent infrastructure · Implementation</MonoLabel>
            <h1 className="sn-hero-h1" style={{ margin: 0, font: "var(--text-display)", letterSpacing: "var(--tracking-display)" }}>
              We build operating systems for AI-enabled companies.
            </h1>
            <p style={{ font: "var(--text-body-l)", color: "var(--text-secondary)", maxWidth: "52ch", margin: "24px 0 32px" }}>
              Sanction AI turns fragmented experiments into systems that run the business: agent
              infrastructure, internal tools, automated workflows, and the policies that keep them accountable.
            </p>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <a className="sn-btn sn-btn-primary sn-btn-l" href={CALENDLY_URL} target="_blank" rel="noopener">
                Bring us a workflow
              </a>
              <a className="sn-btn sn-btn-secondary sn-btn-l" href="#agent-wallet">See the agent wallet →</a>
            </div>
          </div>
          <WalletVisual />
        </div>
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
              The advice comes from operating real systems with real users — not from slides. It&apos;s
              also how the job finishes: when we put agents inside your company, the platform we
              built governs what they may spend and do — teams as budgets, a human over the line,
              and a record finance can audit.
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
                Answer for what your agents spend and do
              </h3>
              <p style={{ margin: "0 0 20px", fontSize: 14.5, lineHeight: 1.55, color: "#C4C7BB" }}>
                Budgets, human sign-off, and a signed record of what agents spend and do.
                MCP, REST, Bedrock — the wallet travels with the agent.
              </p>
              <Link className="sn-btn sn-btn-onDark sn-btn-m" href="/platform">Explore the platform →</Link>
            </div>
          </div>
        </div>
      </section>

      {/* The platform in depth — the proof chapter continues, still on dark.
          Sits AFTER the services argument on purpose: the exec buyer reads why
          they called before meeting `npx`. Deep detail lives on /platform. */}
      <section
        id="agent-wallet"
        className="sn-wallet-section"
        data-theme="dark"
        style={{ borderTop: "1px solid rgba(242,241,234,.08)" }}
      >
        <div style={{ ...wrap, padding: "104px 32px 112px" }}>
          <div className="sn-wallet-intro">
            <div>
              <MonoLabel color="#43D5A1" mb={16}>New in Sanction</MonoLabel>
              <h2>The wallet an AI agent carries.</h2>
            </div>
            <div>
              <p>
                Identity says who the agent is. Payment rails move money. Sanction carries the
                missing operating authority: what this agent may do, under whose policy, within
                what budget, and with what proof.
              </p>
              <div className="sn-inline-links">
                <Link href="/docs/agent-wallet">Read the architecture →</Link>
                <a href="/.well-known/wallet-card.json">Inspect the Wallet Card ↗</a>
              </div>
            </div>
          </div>
          <WalletFlow />
          <div className="sn-mcp-panel">
            <div className="sn-mcp-code">
              <div className="sn-mcp-window"><i /><i /><i /><span>sanction-mcp</span></div>
              <code><b>$</b> npx sanction-mcp</code>
              <code><em>✓</em> wallet connected <span>ops_agent_07</span></code>
              <code><em>✓</em> 10 governance tools available</code>
              <code><b>→</b> sanction_authorize_tool</code>
              <code className="sn-code-result">AUTHORIZED · request dec_8f31</code>
            </div>
            <div className="sn-mcp-copy">
              <MonoLabel color="#43D5A1" mb={14}>MCP 0.7 · Ten tools</MonoLabel>
              <h3>Authority becomes part of the agent&apos;s runtime.</h3>
              <p>
                Govern spend, provisioning, tools, capabilities, credentials, token cost, and
                outcomes from any MCP host. Mint short-lived mandates for child agents and let
                counterparties verify them without a Sanction API key.
              </p>
              <div className="sn-tool-grid">
                <span>SPEND</span><span>TOOLS</span><span>CAPABILITIES</span><span>CREDENTIALS</span><span>OUTCOMES</span><span>APPROVALS</span>
              </div>
              <p className="sn-honesty">Today&apos;s stdio MCP is cooperative. Enforced tool interception is the next hosted broker phase.</p>
              {/* Both funnels get a next step: install it yourself, or have us do it. */}
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <a className="sn-btn sn-btn-primary sn-btn-m" href={CALENDLY_URL} target="_blank" rel="noopener">Have us install it →</a>
                <a className="sn-btn sn-btn-onDark sn-btn-m" href="https://www.npmjs.com/package/sanction-mcp">Install the MCP server ↗</a>
              </div>
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
          <a className="sn-btn sn-btn-primary sn-btn-l" href={CALENDLY_URL} target="_blank" rel="noopener" style={{ marginTop: 28 }}>
            Book discovery
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ borderTop: "1px solid var(--line-2)" }}>
        <div style={{ ...wrap, display: "flex", alignItems: "center", gap: 24, padding: 32, fontSize: 13, color: "var(--text-muted)", flexWrap: "wrap" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, color: "var(--text-body)" }}>
            <img src="/brand/sanction-wordmark-green.svg" alt="Sanction" style={{ height: 18 }} />
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
