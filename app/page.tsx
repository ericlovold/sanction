import type { Metadata } from "next"
import Link from "next/link"
import "./brand.css"
import { brandFontVars } from "./brand-fonts"

export const metadata: Metadata = {
  title: "Sanction — Stop runaway AI API spend",
  description:
    "Put hard limits in front of AI spend, MCP tools, and x402 payments. Sanction authorizes the spend; any rail settles it.",
}

const structuredData = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Sanction",
  url: "https://getsanction.com",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Web, API",
  description:
    "Sanction authorizes AI spend, MCP tool calls, and x402 payment demands before they become irreversible.",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
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
    "The agent kept retrying",
    "It kept reading, checking, and repairing after it passed the number you had in your head. Your provider kept accepting calls. Your card kept paying.",
  ],
  [
    "The alert arrived after the spend",
    "Usage dashboards explain what happened. They do not decide whether the next call is allowed to leave your stack.",
  ],
  [
    "The action could not be taken back",
    "A destructive tool call or signed machine payment needs authorization before execution, not a report after it clears.",
  ],
]

const WORKFLOWS: [string, string, string][] = [
  [
    "01",
    "Govern MCP tools before they run",
    "Put the hosted broker in front of an MCP server. Block destructive tools, escalate sensitive ones, and return a machine-readable refusal before the upstream receives the call.",
  ],
  [
    "02",
    "Cap AI spend by team",
    "Change the model gateway base URL. Wallet-tree budgets enforce agent, team, and organization caps without instrumenting every call.",
  ],
  [
    "03",
    "Authorize x402 before the wallet signs",
    "Send the payment challenge to Sanction first. It prices the worst case, applies policy, and withholds a denied demand before the wallet can sign it.",
  ],
]

const STEPS: [string, string, string][] = [
  [
    "1",
    "Connect one enforcement point",
    "Use the LLM gateway, the hosted MCP broker, or the pre-sign quote endpoint. Your provider, tools, and payment rail stay yours.",
  ],
  [
    "2",
    "Set the policy",
    "Define agent and team budgets, allowed or blocked tools, escalation bands, and the hard line that cannot be crossed.",
  ],
  [
    "3",
    "Get a deterministic decision",
    "Approved proceeds. Escalated pauses for a human and a one-use grant. Denied stops the provider call, tool call, or wallet action.",
  ],
  [
    "4",
    "Export the evidence",
    "Every decision is attributable and exportable in a signed, hash-chained record for engineering, finance, and audit.",
  ],
]

const WONT: string[] = [
  "Sanction does not settle payments. It authorizes the spend; any rail settles it.",
  "Sanction does not replace your model provider or MCP server. It governs whether the next request may reach them.",
  "Sanction does not custody signing keys. In the broker, a denied x402 challenge is withheld before your wallet sees payment instructions.",
  "Sanction cannot govern traffic routed around it. Enforcement applies at the gateway, broker, and authorization endpoints you connect.",
]

// Stacked-coin balance visual, replacing the old stats-card face. Built from
// the card's own tokens (pine gradient, --signal green, #f2f1ea ink) rather
// than a photoreal render, so it reads as part of the same object as the
// mandate card next to it, not a stock illustration dropped on top.
function CoinStack() {
  return (
    <svg viewBox="0 0 340 190" width="100%" height="140" aria-hidden="true">
      <defs>
        <radialGradient id="coinFace" cx="32%" cy="28%" r="80%">
          <stop offset="0%" stopColor="#2f8f70" />
          <stop offset="55%" stopColor="#17614b" />
          <stop offset="100%" stopColor="#0c332a" />
        </radialGradient>
        <filter id="coinShadow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="8" />
        </filter>
      </defs>

      <ellipse cx="175" cy="178" rx="150" ry="10" fill="#000" opacity="0.35" filter="url(#coinShadow)" />

      {/* back stack, edge-on */}
      {[168, 156, 144, 132].map((cy, i) => (
        <ellipse key={cy} cx="95" cy={cy} rx="58" ry="14" fill={i % 2 === 0 ? "#124a3a" : "#17614b"} stroke="rgba(242,241,234,0.1)" />
      ))}
      <ellipse cx="95" cy="122" rx="58" ry="17" fill="#23795f" stroke="rgba(242,241,234,0.14)" />

      {/* front coin */}
      <circle cx="226" cy="97" r="72" fill="url(#coinFace)" stroke="rgba(242,241,234,0.16)" />
      <circle cx="226" cy="97" r="58" fill="none" stroke="rgba(242,241,234,0.22)" strokeWidth="1.5" />
      <path d="M 174 60 A 72 72 0 0 1 268 55" fill="none" stroke="var(--signal)" strokeWidth="2.5" strokeLinecap="round" opacity="0.8" />
      <text x="226" y="97" textAnchor="middle" dominantBaseline="central" dy="2" fontFamily="var(--font-mono)" fontSize="58" fontWeight="600" fill="#f2f1ea">
        $
      </text>
    </svg>
  )
}

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
        <CoinStack />
        {/* Deliberately NOT a balance. Sanction is non-custodial — it holds no
            funds and can never initiate a transfer, only refuse one, which is
            what keeps it inside CLARITY §604's non-controlling test. An
            "available" figure reads as custody to the exact audience that cares
            most, so the readout states the limit instead of a balance. */}
        <div className="sn-wallet-stats" style={{ gridTemplateColumns: "1fr", textAlign: "center", marginTop: 8 }}>
          <div><span>DAILY CAP</span><strong style={{ fontSize: 20, letterSpacing: "0.04em" }}>ENFORCED</strong></div>
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

      {/* Product launch ribbon */}
      <Link
        href="/changelog"
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
        x402 spend gate is live — authorize the demand before the wallet signs →
      </Link>

      {/* Nav */}
      <nav style={{ position: "sticky", top: 0, zIndex: 40, background: "rgba(251,250,246,.8)", backdropFilter: "blur(12px)", borderBottom: "1px solid var(--line-2)" }}>
        <div style={{ ...wrap, display: "flex", alignItems: "center", gap: 32, height: 64 }}>
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 600, fontSize: 17, letterSpacing: "-0.02em" }}>
            <img src="/brand/sanction-wordmark-green.svg" alt="Sanction" style={{ height: 25 }} />
            <span className="sn-lockup-tag" aria-hidden="true"><span>Agent authorization</span></span>
          </Link>
          <div className="sn-nav-links" style={{ display: "flex", gap: 24, fontSize: 14, marginLeft: 16, whiteSpace: "nowrap" }}>
            <a className="sanction-link" href="#workflows">Workflows</a>
            <Link className="sanction-link" href="/platform">Platform</Link>
            <Link className="sanction-link" href="/slack">Slack</Link>
            <Link className="sanction-link" href="/docs">Docs</Link>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
            <Link className="sn-btn sn-btn-ghost sn-btn-s" href="/login">Sign in</Link>
            <Link className="sn-btn sn-btn-primary sn-btn-s" href="/start">Start free</Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <header className="sn-home-hero">
        <div className="sn-home-hero-grid" style={wrap}>
          <div>
            <MonoLabel mb={20}>Runaway agent spend, stopped</MonoLabel>
            <h1 className="sn-hero-h1" style={{ margin: 0, font: "var(--text-display)", letterSpacing: "var(--tracking-display)" }}>
              Your agent can run. Your API bill can&apos;t.
            </h1>
            <p style={{ font: "var(--text-body-l)", color: "var(--text-secondary)", maxWidth: "52ch", margin: "24px 0 32px" }}>
              Set a hard limit before the next model call leaves your stack. Sanction authorizes AI
              spend, MCP tools, and x402 payment demands before they become irreversible.
            </p>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <Link className="sn-btn sn-btn-primary sn-btn-l" href="/start">Start free</Link>
              <a className="sn-btn sn-btn-secondary sn-btn-l" href="#workflows">See the workflows →</a>
            </div>
          </div>
          <WalletVisual />
        </div>
      </header>

      {/* Why authorization comes first */}
      <section style={{ ...wrap, padding: "96px 32px 112px" }}>
        <div style={{ maxWidth: 620, marginBottom: 48 }}>
          <MonoLabel mb={16}>Why authorization comes first</MonoLabel>
          <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>
            Runaway spend is not an observability problem.
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

      {/* Workflows */}
      <section id="workflows" style={{ borderTop: "1px solid var(--line-2)", background: "var(--surface-sunken)" }}>
        <div style={{ ...wrap, padding: "96px 32px 112px" }}>
          <div style={{ maxWidth: 620, marginBottom: 48 }}>
            <MonoLabel mb={16}>Three governed workflows</MonoLabel>
            <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>
              Start with the most expensive failure mode.
            </h2>
            <p style={{ font: "var(--text-body-l)", color: "var(--text-secondary)", maxWidth: "54ch", margin: "20px 0 0" }}>
              One decision engine sits in front of three irreversible actions. Sanction authorizes
              the spend; any rail settles it.
            </p>
          </div>
          <div className="sn-cards">
            {WORKFLOWS.map(([n, t, d]) => (
              <div key={n} className="sn-card" style={{ padding: 28 }}>
                <MonoLabel color="var(--pine-7)">Workflow {n}</MonoLabel>
                <h3 style={{ margin: "12px 0 8px", font: "var(--text-h3)" }}>{t}</h3>
                <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55, color: "var(--text-secondary)" }}>{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" style={{ ...wrap, padding: "112px 32px" }}>
        <div style={{ maxWidth: 620, marginBottom: 48 }}>
          <MonoLabel mb={16}>How it works</MonoLabel>
          <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>
            Put policy in the path, not beside it.
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

      {/* The platform in depth */}
      <section
        id="agent-wallet"
        className="sn-wallet-section"
        data-theme="dark"
        style={{ borderTop: "1px solid rgba(242,241,234,.08)" }}
      >
        <div style={{ ...wrap, padding: "104px 32px 112px" }}>
          <div className="sn-wallet-intro">
            <div>
              <MonoLabel color="#43D5A1" mb={16}>The control plane</MonoLabel>
              <h2>Policy travels with the agent.</h2>
            </div>
            <div>
              <p>
                Identity says who the agent is. Payment rails move money. Sanction carries the
                missing authority: what the agent may spend or invoke, under whose policy, within
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
              <MonoLabel color="#43D5A1" mb={14}>Governed MCP</MonoLabel>
              <h3>Put policy in front of every tools/call.</h3>
              <p>
                Register an upstream once, then point the MCP host at Sanction&apos;s broker. Every
                tool call is authorized before a byte reaches the upstream, and the upstream
                credential stays in the vault.
              </p>
              <div className="sn-tool-grid">
                <span>SPEND</span><span>TOOLS</span><span>CAPABILITIES</span><span>CREDENTIALS</span><span>OUTCOMES</span><span>APPROVALS</span>
              </div>
              <p className="sn-honesty">Brokered traffic is enforced. Calls sent directly to the upstream bypass Sanction and are not governed.</p>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <Link className="sn-btn sn-btn-primary sn-btn-m" href="/start">Create a wallet →</Link>
                <a className="sn-btn sn-btn-onDark sn-btn-m" href="https://www.npmjs.com/package/sanction-mcp">Install the MCP server ↗</a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Product boundary */}
      <section style={{ ...wrap, padding: "112px 32px" }}>
        <div style={{ maxWidth: 620, marginBottom: 40 }}>
          <MonoLabel mb={16}>The product boundary</MonoLabel>
          <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>
            What Sanction does not do.
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
          <MonoLabel mb={16}>Start with one workflow</MonoLabel>
          <h2 style={{ margin: 0, font: "var(--text-h2)", letterSpacing: "var(--tracking-heading)" }}>
            Put a hard limit in front of the next irreversible action.
          </h2>
          <Link className="sn-btn sn-btn-primary sn-btn-l" href="/start" style={{ marginTop: 28 }}>Start free</Link>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ borderTop: "1px solid var(--line-2)" }}>
        <div style={{ ...wrap, display: "flex", alignItems: "center", gap: 24, padding: 32, fontSize: 13, color: "var(--text-muted)", flexWrap: "wrap" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, color: "var(--text-body)" }}>
            <img src="/brand/sanction-wordmark-green.svg" alt="Sanction" style={{ height: 18 }} />
          </span>
          <span>Sanction authorizes the spend. Any rail settles it.</span>
          <span style={{ marginLeft: "auto", display: "flex", gap: 20, flexWrap: "wrap" }}>
            <Link className="sanction-link" href="/platform">Platform</Link>
            <Link className="sanction-link" href="/slack">Slack</Link>
            <Link className="sanction-link" href="/about">About</Link>
            <Link className="sanction-link" href="/roadmap">Roadmap</Link>
            <Link className="sanction-link" href="/changelog">Changelog</Link>
            <a className="sanction-link" href="/api/openapi.json">API</a>
            <a className="sanction-link" href="https://www.npmjs.com/package/sanction-mcp">MCP</a>
            <Link className="sanction-link" href="/support">Support</Link>
            <Link className="sanction-link" href="/privacy">Privacy</Link>
          </span>
        </div>
      </footer>
    </main>
  )
}
