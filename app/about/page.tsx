import type { Metadata } from "next"
import Link from "next/link"
import "../brand.css"
import { brandFontVars } from "../brand-fonts"

// Rebuilt 2026-08 for the Sanction AI reposition: we-voice firm story with the
// two people behind it. Dr. Ping's photo: drop the file at
// public/brand/ac-ping.jpg and set PING_PHOTO below — the card renders a
// monogram until then, so shipping isn't blocked on the asset.

export const metadata: Metadata = {
  title: "About Sanction AI — AI you can answer for",
  description:
    "Sanction AI is an AI advisory and implementation firm. We install working AI on real business workflows, and we build the trust layer for it: the Sanction authorization platform and the Moral Intention Analyst, authored with Dr. A.C. Ping, PhD.",
}

const CALENDLY_URL = process.env.NEXT_PUBLIC_CALENDLY_URL || "https://calendly.com/ericlovold/30min"

const wrap: React.CSSProperties = { maxWidth: 1120, margin: "0 auto", padding: "0 32px" }

// Set to "/brand/ac-ping.jpg" once the photo lands in public/brand/.
const PING_PHOTO: string | null = null

const TEAM: {
  name: string
  role: string
  photo: string | null
  monogram: string
  bio: string[]
  links: [string, string][]
}[] = [
  {
    name: "Eric Lovold",
    role: "Founder · Builder",
    photo: "/brand/eric-lovold.jpg",
    monogram: "EL",
    bio: [
      "Eric builds and installs the systems: the Sanction Platform, the Moral Intention Analyst's productization, and every client implementation. A decade driving outcomes in healthcare and enterprise technology, now entirely focused on working AI for real businesses.",
      "Anthropic-certified across the Claude platform — Bedrock, Claude Code, MCP, and the API.",
    ],
    links: [["ericlovold.com", "https://www.ericlovold.com"]],
  },
  {
    name: "Dr. A.C. Ping, PhD",
    role: "Ethics Framework Author · Brain Trust, MIA",
    photo: PING_PHOTO,
    monogram: "AP",
    bio: [
      "Dr. Ping is the author of the ethical methodology the Moral Intention Analyst runs on, and its final authority — every framework interpretation, amendment, and version ships with his approval.",
      "An ethicist and advisor with decades of practice helping people and organisations see what is at stake and choose consciously.",
    ],
    links: [
      ["acping.net", "https://www.acping.net"],
      ["Ethics Advisory Services", "https://www.ethicsadvisoryservices.com.au"],
    ],
  },
]

export default function About() {
  return (
    <main className={`sanction ${brandFontVars}`} style={{ minHeight: "100vh" }}>
      {/* Nav */}
      <nav style={{ position: "sticky", top: 0, zIndex: 40, background: "rgba(251,250,246,.8)", backdropFilter: "blur(12px)", borderBottom: "1px solid var(--line-2)" }}>
        <div style={{ ...wrap, display: "flex", alignItems: "center", gap: 32, height: 64 }}>
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 600, fontSize: 17, letterSpacing: "-0.02em" }}>
            <img src="/brand/sanction-wordmark-green.svg" alt="Sanction" style={{ height: 25 }} />
          </Link>
          <div className="sn-nav-links" style={{ display: "flex", gap: 24, fontSize: 14, marginLeft: 16, whiteSpace: "nowrap" }}>
            <Link className="sanction-link" href="/">Services</Link>
            <Link className="sanction-link" href="/moral-intention">Moral Intention</Link>
            <Link className="sanction-link" href="/platform">Platform</Link>
            <Link className="sanction-link" href="/docs">Docs</Link>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
            <a className="sn-btn sn-btn-primary sn-btn-s" href={CALENDLY_URL} target="_blank" rel="noopener">
              Book discovery
            </a>
          </div>
        </div>
      </nav>

      {/* The thesis */}
      <header style={{ ...wrap, padding: "96px 32px 72px", maxWidth: 780 }}>
        <div className="sn-mono" style={{ marginBottom: 20 }}>About Sanction AI</div>
        <h1 style={{ margin: 0, font: "var(--text-display)", letterSpacing: "var(--tracking-display)" }}>
          AI you can answer for.
        </h1>
        <p style={{ font: "var(--text-body-l)", color: "var(--text-secondary)", margin: "24px 0 0", maxWidth: "58ch" }}>
          Everything we build and install holds one thesis: a human stays accountable. The Sanction
          Platform governs what autonomous agents may do — budgets, sign-off, a signed audit trail.
          The Moral Intention Analyst works the human side: it reads the documents, decisions, and
          processes people are responsible for and surfaces their ethical dimension, so whoever
          holds the call can see what&apos;s at stake before they make it. Our services practice is
          the same idea applied by hand: working AI, installed on real workflows, with your team in
          charge of it.
        </p>
      </header>

      {/* The people */}
      <section style={{ ...wrap, padding: "24px 32px 112px" }}>
        <div className="sn-mono" style={{ marginBottom: 28 }}>The people</div>
        <div className="sn-pair">
          {TEAM.map((p) => (
            <div key={p.name} className="sn-card" style={{ padding: 32 }}>
              {p.photo ? (
                <img
                  src={p.photo}
                  alt={p.name}
                  style={{ width: 132, height: 132, objectFit: "cover", borderRadius: "var(--radius-card)", border: "1px solid var(--line-1)" }}
                />
              ) : (
                <div
                  aria-hidden
                  style={{
                    width: 132,
                    height: 132,
                    borderRadius: "var(--radius-card)",
                    border: "1px solid var(--line-1)",
                    background: "var(--pine-tint)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 600,
                    fontSize: 34,
                    color: "var(--pine-8)",
                    letterSpacing: "0.02em",
                  }}
                >
                  {p.monogram}
                </div>
              )}
              <h2 style={{ margin: "20px 0 4px", font: "var(--text-h2)", letterSpacing: "var(--tracking-heading)" }}>{p.name}</h2>
              <div className="sn-mono" style={{ color: "var(--pine-7)", marginBottom: 16 }}>{p.role}</div>
              {p.bio.map((b) => (
                <p key={b} style={{ margin: "0 0 12px", fontSize: 15, lineHeight: 1.6, color: "var(--text-secondary)" }}>
                  {b}
                </p>
              ))}
              <div style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
                {p.links.map(([label, href]) => (
                  <a key={href} className="sanction-link" href={href} target="_blank" rel="noopener" style={{ fontSize: 13.5, textDecoration: "underline", textUnderlineOffset: 3 }}>
                    {label} ↗
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Industries */}
      <section style={{ ...wrap, padding: "0 32px 112px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center" }}>
          {["Financial Services", "Healthcare", "Legal", "Real Estate"].map((i) => (
            <span
              key={i}
              className="sn-mono"
              style={{
                color: "var(--pine-7)",
                border: "1px solid var(--line-1)",
                borderRadius: "var(--radius-pill)",
                padding: "8px 16px",
                letterSpacing: "0.1em",
              }}
            >
              {i}
            </span>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section style={{ borderTop: "1px solid var(--line-2)", background: "var(--surface-sunken)" }}>
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "88px 32px", textAlign: "center" }}>
          <div className="sn-mono" style={{ marginBottom: 16 }}>First conversation</div>
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
            <Link className="sanction-link" href="/">Services</Link>
            <Link className="sanction-link" href="/moral-intention">Moral Intention</Link>
            <Link className="sanction-link" href="/platform">Platform</Link>
            <Link className="sanction-link" href="/roadmap">Roadmap</Link>
            <Link className="sanction-link" href="/changelog">Changelog</Link>
          </span>
        </div>
      </footer>
    </main>
  )
}
