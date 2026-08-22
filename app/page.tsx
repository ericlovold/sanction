import type { Metadata } from "next"
import Link from "next/link"
import { AnthropicCerts } from "@/components/anthropic-certs"
import "./brand.css"
import { brandFontVars } from "./brand-fonts"

export const metadata: Metadata = {
  title: "Sanction — Stop runaway AI API spend",
  description:
    "Put hard limits in front of AI spend, MCP tools, and x402 payments. Sanction authorizes the spend; any rail settles it.",
}

const structuredData = [
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Sanction",
    url: "https://getsanction.com",
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Web, API",
    description:
      "Sanction governs human authorization workflows for autonomous systems — spend and provisioning authorization, tool governance, scoped credential injection, and an audit trail. It is not a sanctions-screening, watchlist, or AML compliance tool.",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  },
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Is Sanction a sanctions-screening or AML compliance tool?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "No. Despite the name, Sanction is not a sanctions, watchlist, or AML screening product. Sanction governs human authorization workflows for autonomous systems — it decides whether an AI agent may spend money, invoke a tool, provision a resource, or use a secret before it acts, and logs every decision.",
        },
      },
    ],
  },
]

function MonoLabel({ children, color, mt, mb }: { children: React.ReactNode; color?: string; mt?: number; mb?: number }) {
  return (
    <div className="sn-mono" style={{ color, marginTop: mt, marginBottom: mb }}>
      {children}
    </div>
  )
}

// The hero object: a physical-feeling agent credential. Sized in container-query
// units (cqw) against its own width, so it stays perfectly proportional and
// clip-free at any rendered size — full 400px on desktop, fluid on mobile.
function AccessKeyCard({ width = 400 }: { width?: number }) {
  const cq = (px: number) => `${((px / 380) * 100).toFixed(2)}cqw`
  const faint = "rgba(237,233,220,.6)"
  return (
    <div
      className="sn-keycard"
      style={{
        width: "100%",
        maxWidth: width,
        aspectRatio: "1.586 / 1",
        borderRadius: cq(13),
        padding: `${cq(20)} ${cq(26)}`,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        color: "#EDE9DC",
        background: "linear-gradient(135deg,#124A3A 0%,#0C332A 55%,#0A2B23 100%)",
        position: "relative",
        overflow: "hidden",
        fontFamily: "var(--font-sans)",
      }}
    >
      {/* diagonal security hatching */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background: "repeating-linear-gradient(115deg, rgba(237,233,220,0.05) 0 1px, transparent 1px 7px)",
        }}
      />
      {/* diagonal shine sweep */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background: "linear-gradient(115deg,transparent 30%,rgba(251,250,246,.08) 45%,transparent 60%)",
        }}
      />

      {/* top: wordmark + contactless */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: cq(17), letterSpacing: cq(2.4) }}>SANCTION</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: cq(9.5), letterSpacing: ".14em", textTransform: "uppercase", color: "rgba(120,224,178,.85)", marginTop: cq(4) }}>
            Agent Access Key
          </div>
        </div>
        <svg aria-hidden viewBox="0 0 24 24" style={{ width: cq(22), height: cq(22), color: "rgba(120,224,178,.9)", flexShrink: 0 }} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M8.5 7.5a7 7 0 0 1 0 9" />
          <path d="M12 5a11 11 0 0 1 0 14" />
          <path d="M15.5 2.5a15 15 0 0 1 0 19" />
        </svg>
      </div>

      {/* chip */}
      <div
        aria-hidden
        style={{
          width: cq(46),
          height: cq(34),
          borderRadius: cq(7),
          background: "linear-gradient(135deg,#EED9A0 0%,#D4AF5E 45%,#B58328 100%)",
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,.28), inset 0 -6px 10px rgba(90,60,10,.25)",
        }}
      />

      {/* key number + clearance */}
      <div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: cq(17), letterSpacing: ".06em", whiteSpace: "nowrap" }}>PXY · •••• · •••• · AGNT</div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: cq(10), letterSpacing: ".08em", textTransform: "uppercase", color: faint, marginTop: cq(8) }}>
          Clearance ◆ 5 · Valid thru ∞
        </div>
      </div>

      {/* bottom: cardholder + hologram */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: cq(12) }}>
        <div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: cq(10), letterSpacing: ".08em", textTransform: "uppercase", color: faint }}>Cardholder</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: cq(12.5), letterSpacing: ".05em", marginTop: cq(3), whiteSpace: "nowrap" }}>AUTONOMOUS AGENT</div>
        </div>
        <div
          aria-hidden
          style={{
            width: cq(38),
            height: cq(38),
            borderRadius: "50%",
            flexShrink: 0,
            background: "conic-gradient(from 210deg, #7ff0d0, #86b7ff, #d59bff, #ffd48a, #8fffd0, #7ff0d0)",
            boxShadow: "inset 0 0 0 1px rgba(255,255,255,.35), inset 0 2px 6px rgba(255,255,255,.5)",
            opacity: 0.92,
          }}
        />
      </div>
    </div>
  )
}

const DECISIONS = {
  approved: { label: "Approved", color: "var(--status-approved)", bg: "var(--status-approved-bg)" },
  escalated: { label: "Escalated", color: "var(--status-escalated)", bg: "var(--status-escalated-bg)" },
  denied: { label: "Denied", color: "var(--status-denied)", bg: "var(--status-denied-bg)" },
} as const

function DecisionPill({ decision }: { decision: keyof typeof DECISIONS }) {
  const d = DECISIONS[decision]
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        borderRadius: "var(--radius-pill)",
        fontWeight: 500,
        background: d.bg,
        color: d.color,
        fontSize: 13,
        padding: "5px 14px",
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: 99, background: "currentColor" }} />
      {d.label}
    </span>
  )
}

const wrap: React.CSSProperties = { maxWidth: 1120, margin: "0 auto", padding: "0 32px" }

export default function Landing() {
  return (
    <main className={`sanction ${brandFontVars}`} style={{ minHeight: "100vh" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />

      {/* Nav */}
      <nav style={{ position: "sticky", top: 0, zIndex: 40, background: "rgba(251,250,246,.8)", backdropFilter: "blur(12px)", borderBottom: "1px solid var(--line-2)" }}>
        <div style={{ ...wrap, display: "flex", alignItems: "center", gap: 32, height: 64 }}>
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 600, fontSize: 17, letterSpacing: "-0.02em" }}>
            <img src="/brand/sanction-mark.svg" alt="" style={{ width: 24, height: 24 }} />
            Sanction
          </Link>
          <div className="sn-nav-links" style={{ display: "flex", gap: 24, fontSize: 14, marginLeft: 16, whiteSpace: "nowrap" }}>
            <a className="sanction-link" href="#workflows">Workflows</a>
            <a className="sanction-link" href="#how">How it works</a>
            <a className="sanction-link" href="#security">Security</a>
            <Link className="sanction-link" href="/compatibility">Compatibility</Link>
            <Link className="sanction-link" href="/docs">Docs</Link>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
            <Link className="sn-btn sn-btn-ghost sn-btn-s" href="/login">Sign in</Link>
            <Link className="sn-btn sn-btn-primary sn-btn-s" href="/start">Start free</Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <header className="sn-hero sn-pad" style={{ ...wrap, padding: "96px 32px 112px" }}>
        <div>
          <MonoLabel mb={20}>Spend governance for autonomous systems</MonoLabel>
          <h1 className="sn-hero-h1" style={{ margin: 0, font: "var(--text-display)", letterSpacing: "var(--tracking-display)" }}>
            Your agent can run. Your API bill can&apos;t.
          </h1>
          <p style={{ font: "var(--text-body-l)", color: "var(--text-secondary)", maxWidth: "46ch", margin: "24px 0 32px" }}>
            Set a hard limit before the next model call leaves your stack. Sanction returns a decision before AI spend, an MCP tool call, or an x402 payment can run away.
          </p>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <Link className="sn-btn sn-btn-primary sn-btn-l" href="/start">Start free</Link>
            <Link className="sn-btn sn-btn-secondary sn-btn-l" href="/docs/governed-workflows">See the workflows →</Link>
          </div>
          <MonoLabel mt={28} color="var(--text-faint)">MCP · LLM Gateway · x402</MonoLabel>
        </div>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <div className="sn-key"><AccessKeyCard width={400} /></div>
        </div>
      </header>

      {/* Anthropic-certified trust strip */}
      <AnthropicCerts />

      {/* Workflows */}
      <section id="workflows" style={{ ...wrap, padding: "0 32px 112px" }}>
        <div style={{ maxWidth: 640, marginBottom: 48 }}>
          <MonoLabel mb={16}>Start with one irreversible action</MonoLabel>
          <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>Put a decision in front of the things an agent cannot take back.</h2>
        </div>
        <div className="sn-cards">
          {[
            ["01", "Govern MCP tools before they run", "Broker an MCP server. Block destructive tools, escalate sensitive ones, and return a JSON-RPC refusal before an upstream receives the call."],
            ["02", "Cap AI spend by team", "Change the gateway base URL. Wallet-tree budgets enforce department and organization caps without instrumenting every model call."],
            ["03", "Authorize x402 before the wallet signs", "Send a payment challenge to Sanction first. It prices the worst case, authorizes or withholds the signature, and records the decision."],
          ].map(([k, t, d]) => (
            <div key={k} className="sn-card" style={{ padding: 28 }}>
              <MonoLabel color="var(--pine-7)">Workflow {k}</MonoLabel>
              <h3 style={{ margin: "12px 0 8px", font: "var(--text-h3)" }}>{t}</h3>
              <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55, color: "var(--text-secondary)" }}>{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Decision engine */}
      <section id="how" style={{ ...wrap, padding: "0 32px 112px" }}>
        <div style={{ maxWidth: 560, marginBottom: 48 }}>
          <MonoLabel mb={16}>The decision engine</MonoLabel>
          <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>Policy acts before the call, not after the invoice.</h2>
        </div>
        <div className="sn-cards">
          {[
            ["approved", "Inside policy. The agent proceeds and the decision is recorded."],
            ["escalated", "Over your line. The request pauses for a human; approval mints a one-use grant."],
            ["denied", "Blocked tool, exhausted budget, or hard cap. Sanction withholds the call."],
          ].map(([d, txt]) => (
            <div key={d} style={{ borderTop: "1px solid var(--line-1)", paddingTop: 20 }}>
              <DecisionPill decision={d as keyof typeof DECISIONS} />
              <p style={{ margin: "14px 0 0", fontSize: 14.5, lineHeight: 1.55, color: "var(--text-secondary)" }}>{txt}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Dev section (dark) */}
      <section data-theme="dark" style={{ background: "#0A0A0A", color: "var(--text-body)" }}>
        <div className="sn-two sn-pad" style={{ ...wrap, padding: "96px 32px" }}>
          <div>
            <MonoLabel color="#2CC08D" mb={16}>The LLM spend workflow</MonoLabel>
            <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)", color: "#F2F1EA" }}>One base-URL change. A hard stop before provider spend.</h2>
            <p style={{ fontSize: 16, lineHeight: 1.6, color: "#C4C7BB", maxWidth: "44ch", margin: "20px 0 28px" }}>
              Route your model client through Sanction. When an agent, team, or organization budget is exhausted, the gateway returns 402 before forwarding the request.
            </p>
            <Link className="sn-btn sn-btn-onDark sn-btn-m" href="/docs/gateway">Read the gateway guide →</Link>
          </div>
          <div
            style={{
              background: "#141513",
              border: "1px solid rgba(242,241,234,.1)",
              borderRadius: 14,
              padding: "20px 24px",
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              lineHeight: 1.75,
              color: "#C4C7BB",
              overflowX: "auto",
            }}
          >
            <div style={{ color: "#5C6055", marginBottom: 8 }}># model client</div>
            base_url = &quot;https://getsanction.com/api/gateway/anthropic&quot;<br />
            x-sanction-key = <span style={{ color: "#2CC08D" }}>pxy_••••</span><br />
            <br />
            <span style={{ color: "#5C6055" }}># budget exhausted →</span> <span style={{ color: "#E09A55" }}>402 Payment Required</span>
          </div>
        </div>
      </section>

      {/* Security */}
      <section id="security" style={{ ...wrap, padding: "112px 32px" }}>
        <div className="sn-security">
          <div>
            <MonoLabel mb={16}>Security posture</MonoLabel>
            <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>Built like the company you&apos;re trusting it to be.</h2>
          </div>
          <div className="sn-security-items" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "28px 40px", alignSelf: "center" }}>
            {[
              ["SOC 2 Type II", "In flight — report available under NDA on completion."],
              ["Encrypted + isolated", "AES-256-GCM at rest under a rotating key; row-level tenant isolation at the database."],
              ["Fail-closed", "No policy match, no action. Denial is the default state."],
              ["Full audit trail", "Every decision attributable, exportable, on the record."],
            ].map(([t, d]) => (
              <div key={t} style={{ borderTop: "1px solid var(--line-1)", paddingTop: 16 }}>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{t}</div>
                <div style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--text-muted)", marginTop: 6 }}>{d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Product access */}
      <section id="pricing" style={{ ...wrap, padding: "0 32px 112px" }}>
        <div style={{ maxWidth: 640, margin: "0 auto 32px", textAlign: "center" }}>
          <MonoLabel mb={16}>Put it in the stack</MonoLabel>
          <h2 style={{ margin: 0, font: "var(--text-h2)", letterSpacing: "var(--tracking-heading)" }}>Start with the workflow that has the most expensive failure mode.</h2>
        </div>
        <div className="sn-pair" style={{ maxWidth: 880, margin: "0 auto" }}>
          <div className="sn-card" style={{ padding: 32 }}>
            <MonoLabel>Individual</MonoLabel>
            <div style={{ fontSize: 34, fontWeight: 600, letterSpacing: "-0.02em", margin: "14px 0 4px" }}>Free</div>
            <div style={{ fontSize: 13.5, color: "var(--text-muted)", marginBottom: 20 }}>No card. Build and run a governed workflow in production.</div>
            <Link className="sn-btn sn-btn-secondary sn-btn-m" href="/start" style={{ width: "100%" }}>Start free</Link>
          </div>
          <div className="sn-card" style={{ padding: 32, border: "1px solid var(--pine-8)" }}>
            <MonoLabel color="var(--pine-7)">Enterprise</MonoLabel>
            <div style={{ fontSize: 34, fontWeight: 600, letterSpacing: "-0.02em", margin: "14px 0 4px" }}>Paid license</div>
            <div style={{ fontSize: 13.5, color: "var(--text-muted)", marginBottom: 20 }}>Policy administration, audit export, deployment control, and commercial use.</div>
            <Link className="sn-btn sn-btn-primary sn-btn-m" href="/docs/commercial-license" style={{ width: "100%" }}>Commercial license guide →</Link>
          </div>
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
          <span style={{ marginLeft: "auto", display: "flex", gap: 20, flexWrap: "wrap" }}>
            <Link className="sanction-link" href="/why">Why Sanction</Link>
            <Link className="sanction-link" href="/architecture">Architecture</Link>
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
