import type { Metadata } from "next"
import Link from "next/link"
import { MarketingLeadCapture } from "@/components/marketing-lead-capture"
import { TrackCTA } from "@/components/track-cta"
import { LiveEscalation } from "@/components/live-escalation"
import { getDemoEscalation } from "@/lib/demo"
import "../brand.css"
import { brandFontVars } from "../brand-fonts"

// "Talk to us" → book a call. NEXT_PUBLIC_CALENDLY_URL overrides at build time;
// defaults to Eric's scheduling link so the CTA always books (no dead-end).
const CALENDLY_URL = process.env.NEXT_PUBLIC_CALENDLY_URL || "https://calendly.com/ericlovold/30min"

export const metadata: Metadata = {
  title: "Sanction Platform — Authorization for autonomous AI agents",
  description:
    "The wallet an AI agent carries. One key governs what it may spend, invoke, and provision. Sanction authorizes the spend; any rail settles it — and every decision is on the record.",
}

// The hero shows a LIVE pending escalation from the demo wallet, so the page
// must render per request — not be statically prerendered at build (where the
// demo DB/env isn't available, which froze the fallback card in place).
export const dynamic = "force-dynamic"

const structuredData = [
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Sanction",
    url: "https://getsanction.com/platform",
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Web, API",
    description:
      "Sanction is the wallet an AI agent carries — spend and tool authorization, scoped mandates, and an audit trail. It is not a sanctions-screening, watchlist, or AML compliance tool.",
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

export default async function Landing() {
  // The interactive hero shows a REAL pending escalation from the demo wallet;
  // absent demo data (e.g. a preview env with no SANCTION_WALLET_ID) it falls
  // back to the static access-key visual.
  const escalation = await getDemoEscalation()
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
            <a className="sanction-link" href="#how">How it works</a>
            <a className="sanction-link" href="#rails">Settlement</a>
            <a className="sanction-link" href="#security">Security</a>
            <a className="sanction-link" href="#pricing">Pricing</a>
            <Link className="sanction-link" href="/">Services</Link>
            <Link className="sanction-link" href="/docs">Docs</Link>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
            <Link className="sn-btn sn-btn-ghost sn-btn-s" href="/login">Sign in</Link>
            <TrackCTA className="sn-btn sn-btn-primary sn-btn-s" href="/start" location="nav" target="start">Start free</TrackCTA>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <header className="sn-hero sn-pad" style={{ ...wrap, padding: "96px 32px 112px" }}>
        <div>
          <MonoLabel mb={20}>Authorize · Protect · Govern</MonoLabel>
          <h1 className="sn-hero-h1" style={{ margin: 0, font: "var(--text-display)", letterSpacing: "var(--tracking-display)" }}>
            Autonomy for your agents. Authority for your team.
          </h1>
          <p style={{ font: "var(--text-body-l)", color: "var(--text-secondary)", maxWidth: "48ch", margin: "24px 0 32px" }}>
            Where your AI spend is going, who&apos;s cleared to spend it, and the calls big enough to need your sign-off — in one place, above whatever gateway your engineers run. Every decision on a signed record, made before the money moves.
          </p>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <TrackCTA className="sn-btn sn-btn-primary sn-btn-l" href="/start" location="hero" target="start">Start free</TrackCTA>
            <TrackCTA className="sn-btn sn-btn-secondary sn-btn-l" href={CALENDLY_URL} location="hero" target="talk">Talk to us →</TrackCTA>
          </div>
          <MonoLabel mt={28} color="var(--text-faint)">Agent wallet · MCP · REST · Any rail</MonoLabel>
        </div>
        <div style={{ display: "flex", justifyContent: "center" }}>
          {escalation ? (
            <LiveEscalation initial={escalation} startHref="/start" />
          ) : (
            <div className="sn-key"><AccessKeyCard width={400} /></div>
          )}
        </div>
      </header>

      {/* Who opens Sanction — the seat above the stack (not another gateway) */}
      <section style={{ ...wrap, padding: "96px 32px 112px" }}>
        <div style={{ maxWidth: 620, marginBottom: 48 }}>
          <MonoLabel mb={16}>The seat above the stack</MonoLabel>
          <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>
            Your gateway routes the calls. Sanction is where you answer for them.
          </h2>
          <p style={{ font: "var(--text-body-l)", color: "var(--text-secondary)", maxWidth: "58ch", margin: "20px 0 0" }}>
            LiteLLM, Bedrock, Vercel — let them route, cache, and log. Sanction sits above whatever you run: the one place the people accountable for the spend can see it, set the budget, and sign off on the calls that cross the line.
          </p>
        </div>
        <div className="sn-cards">
          {[
            ["For the CFO", "The monthly number", "Where AI spend went this month — by team, by provider — and whether you're on budget. The one figure that rolls up across every agent, in every division."],
            ["For the CTO", "Who can do what", "Which agents are cleared for which actions, the line where a human takes over, and a signed record of every call. Set the policy once; it holds across providers."],
            ["For the CMO", "My team's usage", "Your department's agent spend and budget at a glance — no ticket to engineering to find out what your team's AI actually costs this month."],
          ].map(([k, t, d]) => (
            <div key={k} className="sn-card" style={{ padding: 28 }}>
              <MonoLabel color="var(--pine-7)">{k}</MonoLabel>
              <h3 style={{ margin: "12px 0 8px", font: "var(--text-h3)" }}>{t}</h3>
              <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55, color: "var(--text-secondary)" }}>{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pillars */}
      <section style={{ ...wrap, padding: "0 32px 112px" }}>
        <div className="sn-cards">
          {[
            ["Authorize", "Agent Wallet", "Budgets and policy on every spend and provisioning action. Auto-approve under threshold, escalate over it, deny what's blocked."],
            ["Protect", "Credential Vault", "AES-256-GCM at rest under a rotating KMS-wrapped key, tenant-isolated at the database. A 15-minute mandate gates every injection; counterparties verify it without a Sanction key."],
            ["Govern", "Clearance Levels", "A 1–5 clearance system. Agents only ever touch what they're explicitly cleared for. Fail-closed by default."],
          ].map(([k, t, d]) => (
            <div key={k} className="sn-card" style={{ padding: 28 }}>
              <MonoLabel color="var(--pine-7)">{k}</MonoLabel>
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
          <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>Every call comes back one of three ways.</h2>
        </div>
        <div className="sn-cards">
          {[
            ["approved", "Under the threshold, allowed category. The agent proceeds; the spend is logged."],
            ["escalated", "Over your line. The request pauses and waits for a human — approval mints a one-use grant."],
            ["denied", "Blocked category or over the hard cap. It never reaches the merchant."],
          ].map(([d, txt]) => (
            <div key={d} style={{ borderTop: "1px solid var(--line-1)", paddingTop: 20 }}>
              <DecisionPill decision={d as keyof typeof DECISIONS} />
              <p style={{ margin: "14px 0 0", fontSize: 14.5, lineHeight: 1.55, color: "var(--text-secondary)" }}>{txt}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Settlement rails — the stablecoin-era argument */}
      <section id="rails" style={{ ...wrap, padding: "0 32px 112px" }}>
        <div style={{ maxWidth: 640, marginBottom: 48 }}>
          <MonoLabel mb={16}>The settlement rail is changing</MonoLabel>
          <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>
            Sanction authorizes the spend; any rail settles it.
          </h2>
          <p style={{ font: "var(--text-body-l)", color: "var(--text-secondary)", maxWidth: "58ch", margin: "20px 0 0" }}>
            Agent payments are moving to stablecoin rails — USDC over x402. On card rails, authorization is one control
            point among several: disputes, chargebacks, and issuer reversals stand behind it. On stablecoin rails there
            are no chargebacks. Settlement is irreversible, and the pre-transaction decision is the only control point.
            That decision is what Sanction makes.
          </p>
        </div>
        <div className="sn-security-items" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "28px 40px" }}>
          {[
            [
              "Settlement-aware ledger — live",
              "Send settlement: {rail, asset, network} with any /v1/authorize call — a closed vocabulary, x402 / USDC / Base today — and the rail is recorded in the decision evidence and the audit CSV export.",
            ],
            [
              "Every decision point, shipped",
              "The MCP broker intercepts tool calls before they run. The LLM gateway meters model spend per call. Escalations pause for a human; approval mints a one-use grant. All of it replayable, with hash-chained evidence exports.",
            ],
            [
              "The x402 spend gate — live",
              "When an agent meets an x402 payment requirement, Sanction prices the quote and runs it through the same ladder as any purchase — before the wallet signs. Through the MCP broker this is interception: a refused challenge is withheld, and an agent that never receives the payment requirements cannot sign them. Quotes priced in USD-pegged stablecoins only; a rate we would have to guess is denied, never estimated.",
            ],
            [
              "Non-custodial, veto-only",
              "Sanction never holds funds or keys, and can never initiate a transfer — it can only refuse one. The GENIUS Act made payment stablecoins a regulated instrument; the pending CLARITY Act (Senate vote scheduled September 2026) would codify that non-custodial, non-controlling software is not a money transmitter. Sanction is built deliberately to that shape — and every decision leaves auditable evidence that supports your compliance program.",
            ],
          ].map(([t, d]) => (
            <div key={t} style={{ borderTop: "1px solid var(--line-1)", paddingTop: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{t}</div>
              <div style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--text-muted)", marginTop: 6 }}>{d}</div>
            </div>
          ))}
        </div>
        <p style={{ margin: "48px 0 0", fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-faint)" }}>
          sanction (v.) — to give official authorization. The older meaning. The one we mean.
        </p>
      </section>

      {/* Dev section (dark) */}
      <section data-theme="dark" style={{ background: "#0A0A0A", color: "var(--text-body)" }}>
        <div className="sn-two sn-pad" style={{ ...wrap, padding: "96px 32px" }}>
          <div>
            <MonoLabel color="#2CC08D" mb={16}>For the builders</MonoLabel>
            <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)", color: "#F2F1EA" }}>Three calls. Governed agent.</h2>
            <p style={{ fontSize: 16, lineHeight: 1.6, color: "#C4C7BB", maxWidth: "44ch", margin: "20px 0 28px" }}>
              Register an agent, set a policy, authorize in real time. The agent carries a wallet over MCP; counterparties verify a mandate with no API key. No SDK lock-in.
            </p>
            <Link className="sn-btn sn-btn-onDark sn-btn-m" href="/docs/agent-wallet">The agent wallet →</Link>
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
            <div style={{ color: "#5C6055", marginBottom: 8 }}># authorize.sh</div>
            curl -X POST /api/v1/authorize \<br />
            &nbsp;&nbsp;-H &quot;x-api-key: <span style={{ color: "#2CC08D" }}>pxy_••••</span>&quot; \<br />
            &nbsp;&nbsp;-d &apos;{"{"} &quot;action&quot;: &quot;purchase&quot;,<br />
            &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&quot;amount_usd&quot;: 12.50 {"}"}&apos;<br />
            <br />
            <span style={{ color: "#5C6055" }}># →</span> {"{"} &quot;status&quot;: <span style={{ color: "#2CC08D" }}>&quot;approved&quot;</span> {"}"}
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

      {/* Pricing */}
      <section id="pricing" style={{ ...wrap, padding: "0 32px 112px" }}>
        <div style={{ maxWidth: 560, margin: "0 auto 48px", textAlign: "center" }}>
          <MonoLabel mb={16}>Pricing</MonoLabel>
          <h2 style={{ margin: 0, font: "var(--text-h2)", letterSpacing: "var(--tracking-heading)" }}>The meter is the decision.</h2>
          <p style={{ fontSize: 15, lineHeight: 1.6, color: "var(--text-secondary)", margin: "12px 0 0" }}>
            Free for individuals. Metered for teams. An agreement for the enterprise.
          </p>
        </div>
        <div className="sn-cards" style={{ maxWidth: 1020, margin: "0 auto" }}>
          <div className="sn-card" style={{ padding: 32 }}>
            <MonoLabel>Individual</MonoLabel>
            <div style={{ fontSize: 34, fontWeight: 600, letterSpacing: "-0.02em", margin: "14px 0 4px" }}>Free</div>
            <div style={{ fontSize: 13.5, color: "var(--text-muted)", marginBottom: 20 }}>No card. Personal, production, and client work.</div>
            <Link className="sn-btn sn-btn-secondary sn-btn-m" href="/start" style={{ width: "100%" }}>Start free</Link>
          </div>
          <div className="sn-card" style={{ padding: 32, border: "1px solid var(--pine-8)" }}>
            <MonoLabel color="var(--pine-7)">Pro · Early access</MonoLabel>
            <div style={{ fontSize: 34, fontWeight: 600, letterSpacing: "-0.02em", margin: "14px 0 4px" }}>
              $20<span style={{ fontSize: 16, fontWeight: 500, color: "var(--text-muted)" }}>/mo</span>
            </div>
            <div style={{ fontSize: 13.5, color: "var(--text-muted)", marginBottom: 10 }}>For teams. 5,000 decisions included, then $5 per 1,000.</div>
            <div style={{ fontSize: 13.5, color: "var(--text-muted)", marginBottom: 10 }}>
              Metered in decisions — the one unit of what Sanction does. Approvals, denials, escalations count once; replays never do.
            </div>
            <div style={{ fontSize: 13.5, color: "var(--text-muted)", marginBottom: 20 }}>Pay by card — or your agent pays via x402/USDC (pilot).</div>
            <a className="sn-btn sn-btn-primary sn-btn-m" href="#stay-in-the-loop" style={{ width: "100%" }}>Join the Pro early access</a>
          </div>
          <div className="sn-card" style={{ padding: 32 }}>
            <MonoLabel>Enterprise</MonoLabel>
            <div style={{ fontSize: 34, fontWeight: 600, letterSpacing: "-0.02em", margin: "14px 0 4px" }}>Agreement</div>
            <div style={{ fontSize: 13.5, color: "var(--text-muted)", marginBottom: 12 }}>SSO, policy administration, audit export, SLA, deployment control.</div>
            <Link className="sanction-link" href="/docs/commercial-license" style={{ fontSize: 13, display: "block", marginBottom: 20 }}>Commercial license guide →</Link>
            <a className="sn-btn sn-btn-secondary sn-btn-m" href={CALENDLY_URL} target={CALENDLY_URL.startsWith("http") ? "_blank" : undefined} rel="noopener" style={{ width: "100%" }}>Talk to us</a>
          </div>
        </div>
      </section>

      {/* Stay in the loop */}
      <section id="stay-in-the-loop" style={{ borderTop: "1px solid var(--line-2)", background: "var(--surface-sunken)" }}>
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "88px 32px", textAlign: "center" }}>
          <MonoLabel mb={16}>Stay in the loop</MonoLabel>
          <h2 style={{ margin: 0, font: "var(--text-h2)", letterSpacing: "var(--tracking-heading)" }}>Not ready to wire up an agent?</h2>
          <p style={{ fontSize: 16, lineHeight: 1.6, color: "var(--text-secondary)", margin: "12px 0 28px" }}>
            Get launch updates and early access as we ship — Pro early access included. One email when it matters — no spam.
          </p>
          <div style={{ maxWidth: 460, margin: "0 auto", textAlign: "left" }}>
            <MarketingLeadCapture source="landing" />
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
            <Link className="sanction-link" href="/">Services</Link>
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
