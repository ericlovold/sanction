import type { Metadata } from "next"
import Link from "next/link"
import "../brand.css"
import { brandFontVars } from "../brand-fonts"

export const metadata: Metadata = {
  title: "Work with Eric — AI implementation for executives & regulated SMBs",
  description:
    "Eric Lovold works 1:1 with executives implementing productive AI workflows, tools, and best practices. He builds AI systems for SMBs in regulated industries: healthcare, legal, and real estate.",
}

// "Book" → Eric's Calendly. NEXT_PUBLIC_CALENDLY_URL overrides at build time.
const CALENDLY_URL = process.env.NEXT_PUBLIC_CALENDLY_URL || "https://calendly.com/eric-getsanction/30min"

const wrap: React.CSSProperties = { maxWidth: 1120, margin: "0 auto", padding: "0 32px" }

const SERVICES: [string, string][] = [
  ["Workflow optimization", "Find where AI removes friction in how your team actually works, then wire it in — measured against real outcomes, not demos."],
  ["AI system implementation", "Design and ship production AI on your infrastructure, built to your compliance bar from day one."],
  ["Design sprints", "A focused week from problem to a working prototype your team can put its hands on and evaluate."],
  ["FDE projects", "Forward-deployed engineering — I embed with your team and build the thing, hands on keyboard, until it ships."],
  ["1:1 coaching", "Direct executive coaching on AI tools, workflows, and judgment. Practical and current, never theoretical."],
]

export default function About() {
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
            <Link className="sanction-link" href="/docs">Docs</Link>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
            <a
              className="sn-btn sn-btn-primary sn-btn-s"
              href={CALENDLY_URL}
              target={CALENDLY_URL.startsWith("http") ? "_blank" : undefined}
              rel="noopener"
            >
              Book a call
            </a>
          </div>
        </div>
      </nav>

      {/* Hero — centered, photo on top */}
      <header style={{ ...wrap, padding: "80px 32px 56px", maxWidth: 720, textAlign: "center" }}>
        <img
          src="/brand/eric-lovold.jpg"
          alt="Eric Lovold"
          style={{ width: 240, maxWidth: "70%", height: "auto", display: "block", margin: "0 auto", borderRadius: "var(--radius-card)", border: "1px solid var(--line-1)" }}
        />
        <div className="sn-mono" style={{ marginTop: 16, marginBottom: 32, letterSpacing: "0.1em" }}>Eric Lovold · Founder, Sanction AI</div>
        <h1 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>
          Putting AI to work for executives and regulated teams.
        </h1>
        <p style={{ font: "var(--text-body-l)", color: "var(--text-secondary)", margin: "24px auto 0", maxWidth: "56ch" }}>
          I work 1:1 with executives and SMBs on implementing productive AI workflows, tools, and best practices.
          I&apos;ve spent the last decade driving outcomes in healthcare and technology, and I am entirely focused on
          what AI means for the future of humanity.
        </p>
        <p style={{ font: "var(--text-body-l)", color: "var(--text-secondary)", margin: "18px auto 32px", maxWidth: "56ch" }}>
          I build AI systems for regulated industries, where confidentiality, audit, and trust are non-negotiable.
        </p>
        <a
          className="sn-btn sn-btn-primary sn-btn-l"
          href={CALENDLY_URL}
          target={CALENDLY_URL.startsWith("http") ? "_blank" : undefined}
          rel="noopener"
        >
          Book a working session →
        </a>
      </header>

      {/* Industries */}
      <section style={{ ...wrap, padding: "0 32px 96px" }}>
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

      {/* Services */}
      <section id="services" style={{ ...wrap, padding: "0 32px 112px" }}>
        <div style={{ maxWidth: 560, margin: "0 auto 48px", textAlign: "center" }}>
          <div className="sn-mono" style={{ marginBottom: 16 }}>What I do</div>
          <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>Five ways to work together.</h2>
        </div>
        <div className="sn-cards" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
          {SERVICES.map(([t, d]) => (
            <div key={t} className="sn-card" style={{ padding: 28 }}>
              <h3 style={{ margin: "0 0 8px", font: "var(--text-h3)" }}>{t}</h3>
              <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55, color: "var(--text-secondary)" }}>{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section id="book" style={{ borderTop: "1px solid var(--line-2)", background: "var(--surface-sunken)" }}>
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "88px 32px", textAlign: "center" }}>
          <div className="sn-mono" style={{ marginBottom: 16 }}>Let&apos;s talk</div>
          <h2 style={{ margin: 0, font: "var(--text-h2)", letterSpacing: "var(--tracking-heading)" }}>Have an AI problem worth solving?</h2>
          <p style={{ fontSize: 16, lineHeight: 1.6, color: "var(--text-secondary)", margin: "12px 0 28px" }}>
            Book a working session and we&apos;ll figure out the highest-leverage place to start.
          </p>
          <a
            className="sn-btn sn-btn-primary sn-btn-l"
            href={CALENDLY_URL}
            target={CALENDLY_URL.startsWith("http") ? "_blank" : undefined}
            rel="noopener"
          >
            Book a working session →
          </a>
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
            <Link className="sanction-link" href="/roadmap">Roadmap</Link>
            <Link className="sanction-link" href="/docs">Docs</Link>
          </span>
        </div>
      </footer>
    </main>
  )
}
