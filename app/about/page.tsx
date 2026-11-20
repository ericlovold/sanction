import type { Metadata } from "next"
import Link from "next/link"
import "../brand.css"
import { brandFontVars } from "../brand-fonts"
import { FOUNDER_NOTE } from "./founder-note"

// Rebuilt 2026-11: getsanction.com is the authorization product only, so this
// page is about the product. Advisory work lives on ericlovold.com.

export const metadata: Metadata = {
  title: "About Sanction",
  description:
    "Sanction is an approval and authorization layer for AI agents. An agent proposes an exact action, a person or a rule decides, and the decision is kept on record.",
  alternates: { canonical: "/about" },
}

const wrap: React.CSSProperties = { maxWidth: 1080, margin: "0 auto", padding: "0 24px" }
const label: React.CSSProperties = { color: "var(--pine-7)", marginBottom: 14 }
const h2: React.CSSProperties = { margin: 0, font: "var(--text-h2)", letterSpacing: "var(--tracking-heading)" }
const band: React.CSSProperties = { borderTop: "1px solid var(--line-2)", borderBottom: "1px solid var(--line-2)", background: "var(--surface-sunken)" }

// Plain-language versions of the engineering principles in docs/DOMAIN.md.
const PRINCIPLES: [string, string][] = [
  ["Your identity system stays the source of truth", "Sanction uses the identities you already have and gives each agent its own governed one. It never becomes your system of record."],
  ["One decision, made in one place", "Budget, rules, approval and the record are resolved together. A request can't pass one check while failing another."],
  ["Same request, same answer", "The same request under the same rules and the same state gets the same decision, so any decision can be replayed and shown later."],
]

const OPEN: { title: string; body: string; href: string; external?: boolean }[] = [
  { title: "Source available", body: "The code is public on GitHub under FSL-1.1-MIT.", href: "https://github.com/ericlovold/sanction", external: true },
  { title: "Public changelog", body: "Every release, including what it does not cover.", href: "/changelog" },
  { title: "Public roadmap", body: "What is shipped, what is next, what is later.", href: "/roadmap" },
  { title: "Dated test status", body: "Which AI tools are verified end to end, and which are not yet.", href: "/docs/connect" },
]

export default function About() {
  return (
    <main className={`sanction ${brandFontVars}`} style={{ minHeight: "100vh" }}>
      <nav aria-label="Main navigation" style={{ position: "sticky", top: 0, zIndex: 40, background: "rgba(251,250,246,.8)", backdropFilter: "blur(12px)", borderBottom: "1px solid var(--line-2)" }}>
        <div style={{ ...wrap, display: "flex", alignItems: "center", gap: 32, minHeight: 64 }}>
          <Link href="/" aria-label="Sanction home" style={{ display: "flex", alignItems: "center" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/sanction-wordmark-green.svg" alt="Sanction" width="130" height="25" />
          </Link>
          <div className="sn-nav-links" style={{ display: "flex", gap: 24, fontSize: 14, whiteSpace: "nowrap" }}>
            <Link className="sanction-link" href="/">Product</Link>
            <Link className="sanction-link" href="/platform">Platform</Link>
            <Link className="sanction-link" href="/docs">Docs</Link>
          </div>
          <Link className="sn-btn sn-btn-primary sn-btn-s" href="/start" style={{ marginLeft: "auto" }}>Try one approval</Link>
        </div>
      </nav>

      <header style={{ ...wrap, maxWidth: 820, padding: "88px 24px 64px" }}>
        <div className="sn-mono" style={label}>About</div>
        <h1 style={{ margin: 0, font: "var(--text-display)", letterSpacing: "var(--tracking-display)" }}>
          Sanction lets AI agents ask before they act.
        </h1>
        <p style={{ font: "var(--text-body-l)", color: "var(--text-secondary)", margin: "24px 0 0", maxWidth: "62ch" }}>
          It is one product: an approval and authorization layer that sits between your agents and the
          things they can change. An agent proposes an exact action, a person or a rule decides, and the
          decision is kept on record.
        </p>
      </header>

      <section style={band} aria-labelledby="founder">
        <div style={{ ...wrap, padding: "64px 24px", display: "flex", flexWrap: "wrap", gap: 40, alignItems: "flex-start" }}>
          <div style={{ flex: "0 1 220px" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/eric-lovold.jpg" alt="Eric Lovold" width="160" height="160" style={{ objectFit: "cover", borderRadius: "var(--radius-card)", border: "1px solid var(--line-1)" }} />
            <h2 id="founder" style={{ margin: "16px 0 2px", font: "var(--text-h3)" }}>Eric Lovold</h2>
            <p style={{ margin: 0, fontSize: 15, color: "var(--text-secondary)" }}>Founder</p>
          </div>
          <div style={{ flex: "999 1 420px", minWidth: 0 }}>
            {FOUNDER_NOTE ? (
              <>
                <div className="sn-mono" style={label}>Why I built it</div>
                <h3 style={{ ...h2, marginBottom: 18 }}>{FOUNDER_NOTE.headline}</h3>
                {FOUNDER_NOTE.paragraphs.map((paragraph) => (
                  <p key={paragraph} style={{ margin: "0 0 14px", color: "var(--text-secondary)", lineHeight: 1.6 }}>{paragraph}</p>
                ))}
              </>
            ) : (
              <>
                <div className="sn-mono" style={label}>Who builds it</div>
                <p style={{ margin: 0, font: "var(--text-body-l)", color: "var(--text-secondary)", maxWidth: "58ch" }}>
                  Sanction is designed, built and supported by its founder. The code, the changelog and the roadmap
                  are public, so you can see what ships and when.
                </p>
              </>
            )}
          </div>
        </div>
      </section>

      <section style={{ ...wrap, padding: "80px 24px" }} aria-labelledby="principles">
        <div className="sn-mono" style={label}>What we hold to</div>
        <h2 id="principles" style={h2}>Three rules the product is built on.</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 18, marginTop: 28 }}>
          {PRINCIPLES.map(([title, body], index) => (
            <article key={title} className="sn-card" style={{ flex: "1 1 280px", padding: 24 }}>
              <div className="sn-mono" style={{ color: "var(--pine-7)" }}>0{index + 1}</div>
              <h3 style={{ margin: "10px 0 8px", font: "var(--text-h3)" }}>{title}</h3>
              <p style={{ margin: 0, fontSize: 16, lineHeight: 1.55, color: "var(--text-secondary)" }}>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section style={band} aria-labelledby="open">
        <div style={{ ...wrap, padding: "72px 24px" }}>
          <div className="sn-mono" style={label}>Built in the open</div>
          <h2 id="open" style={h2}>Check the claims yourself.</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 28 }}>
            {OPEN.map(({ title, body, href, external }) => {
              const card = <><span style={{ display: "block", fontWeight: 600, fontSize: 18, color: "var(--text-body)" }}>{title}</span><span style={{ display: "block", marginTop: 6, fontSize: 15, lineHeight: 1.5, color: "var(--text-secondary)" }}>{body}</span></>
              const style: React.CSSProperties = { flex: "1 1 220px", padding: 20, textDecoration: "none" }
              return external
                ? <a key={href} className="sn-card" href={href} target="_blank" rel="noopener" style={style}>{card}</a>
                : <Link key={href} className="sn-card" href={href} style={style}>{card}</Link>
            })}
          </div>
        </div>
      </section>

      <section style={{ ...wrap, padding: "72px 24px", display: "flex", flexWrap: "wrap", gap: 18 }}>
        <div className="sn-card" style={{ flex: "1 1 360px", padding: 28 }}>
          <h2 style={{ margin: 0, font: "var(--text-h3)" }}>Talk to us about Sanction</h2>
          <p style={{ margin: "10px 0 18px", fontSize: 16, color: "var(--text-secondary)" }}>Questions about setup, security or an organization agreement.</p>
          <Link className="sn-btn sn-btn-primary sn-btn-m" href="/support">Contact support</Link>
        </div>
        <div className="sn-card" style={{ flex: "1 1 360px", padding: 28 }}>
          <h2 style={{ margin: 0, font: "var(--text-h3)" }}>Looking for consulting?</h2>
          <p style={{ margin: "10px 0 18px", fontSize: 16, color: "var(--text-secondary)" }}>Eric&apos;s advisory and implementation work is separate from the product and lives on his own site.</p>
          <a className="sn-btn sn-btn-secondary sn-btn-m" href="https://www.ericlovold.com" target="_blank" rel="noopener">ericlovold.com</a>
        </div>
      </section>

      <footer style={{ borderTop: "1px solid var(--line-2)" }}>
        <div style={{ ...wrap, display: "flex", alignItems: "center", gap: 24, padding: "28px 24px", fontSize: 14, color: "var(--text-secondary)", flexWrap: "wrap" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/sanction-wordmark-green.svg" alt="Sanction" width="94" height="18" />
          <span>Authorize. Protect. Govern.</span>
          <span style={{ marginLeft: "auto", display: "flex", gap: 20, flexWrap: "wrap" }}>
            <Link className="sanction-link" href="/platform">Platform</Link>
            <Link className="sanction-link" href="/install">Install</Link>
            <Link className="sanction-link" href="/docs">Docs</Link>
            <Link className="sanction-link" href="/roadmap">Roadmap</Link>
            <Link className="sanction-link" href="/changelog">Changelog</Link>
            <Link className="sanction-link" href="/privacy">Privacy</Link>
          </span>
        </div>
      </footer>
    </main>
  )
}
