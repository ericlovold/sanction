import type { Metadata } from "next"
import Link from "next/link"
import "./brand.css"
import { brandFontVars } from "./brand-fonts"
import { OperatorsHourRibbon } from "@/components/operators-hour-ribbon"
import { formatSessionDate, nextOperatorsHour } from "@/lib/operatorsHour"

// Regenerate hourly so the ribbon's server-rendered session date never trails
// the schedule by more than an hour; the page stays static between regenerations.
export const revalidate = 3600

export const metadata: Metadata = {
  title: "Sanction — One-off human approvals for AI agent actions",
  description:
    "Your agent proposes an exact action. An authorized person approves or rejects it. The agent redeems an expiring, one-use grant for that identical action before it proceeds. Free for individuals.",
}

const structuredData = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Sanction",
  url: "https://getsanction.com",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Web, API",
  description:
    "One-off human approvals for AI agent actions. An agent requests an exact action, an authorized person approves or rejects it, and the agent redeems an expiring, one-use grant for that identical action. Budgets, an MCP broker, a model gateway, and x402 authorization are also available.",
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

// The one-off approval loop, in the order an agent experiences it. Copy follows
// docs/CONNECT.md and the request-approval skill; it describes Sanction's own
// behavior only.
const LOOP: [string, string, string][] = [
  [
    "1",
    "The agent asks for the exact action",
    "It calls sanction_authorize_tool with the tool, server, and full arguments it intends to use, plus require_approval and a short reason. No policy edit is needed. Existing hard denials still apply.",
  ],
  [
    "2",
    "An authorized person decides",
    "The request waits in the wallet's approval inbox, showing the exact arguments. If Slack is configured for the wallet, the decision can happen there. The agent pauses; it does not poll in a loop.",
  ],
  [
    "3",
    "The agent redeems a one-use grant",
    "After one check, the agent repeats the identical request with the grant. Only authorized: true permits the action, once. Changed arguments and reused or expired grants are refused, and the agent stops.",
  ],
]

const WORKFLOWS: [string, string, string][] = [
  [
    "01",
    "Govern routed MCP tools",
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
    "Use the LLM gateway, the hosted MCP broker, or the pre-sign quote endpoint. Your provider, tools, and payment rail stay yours. Enforcement applies to traffic routed through them.",
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
  "Connecting Sanction does not intercept your host's other tools. A cooperative connection works when the agent consults Sanction and honors its answer; the broker enforces only the upstream calls routed through it.",
  "A decision record proves the authorization decision, not that an external action ran or obeyed it. Outcome logging records business outcomes, not execution receipts, and an unknown result stays unknown.",
  "A yes in chat does not override organizational policy or a hard denial. Asking for approval cannot unlock a blocked action.",
  "Sanction does not settle payments. It authorizes the spend; any rail settles it. In the broker, a denied x402 challenge is withheld before your wallet sees payment instructions.",
]

// Static, labeled walkthrough of the synthetic request in docs/CONNECT.md.
// Illustrative only: nothing here calls Sanction or executes an action.
const EXAMPLE_LINES: [string, string][] = [
  ["→", "sanction_authorize_tool  tool: sanction.demo.approval"],
  ["", "arguments: {\"synthetic\":true,\"execute\":false}"],
  ["", "require_approval: true"],
  ["←", "status: escalated · next_action: wait"],
  ["·", "you review and approve in the approval inbox"],
  ["→", "sanction_check_authorization  (once)"],
  ["←", "next_action: retry_with_grant"],
  ["→", "sanction_authorize_tool  identical input + grant_id"],
  ["←", "authorized: true · next_action: proceed"],
]

// Hero object: an approval request and the one-use grant it produces. Reuses
// the wallet-card / mandate-card brand language. Labeled illustrative and uses
// the synthetic demo tool, so it never reads as a live tenant record.
function ApprovalVisual() {
  return (
    <figure className="sn-wallet-stage" style={{ margin: 0 }} aria-label="Illustrative approval request and one-use grant for a synthetic action">
      <div className="sn-wallet-orbit" aria-hidden="true" />
      <div className="sn-wallet-card">
        <div className="sn-wallet-card-top">
          <img src="/brand/sanction-mark.svg" alt="" />
          <span>APPROVAL REQUEST</span>
          <span className="sn-wallet-live"><i /> WAITING</span>
        </div>
        <div className="sn-wallet-agent" style={{ fontSize: 17, wordBreak: "break-word" }}>sanction.demo.approval</div>
        <div className="sn-wallet-rule" />
        <div className="sn-wallet-stats" style={{ gridTemplateColumns: "1fr" }}>
          <div>
            <span>EXACT ARGUMENTS</span>
            <strong style={{ fontSize: 13.5, wordBreak: "break-word" }}>{"{ \"synthetic\": true, \"execute\": false }"}</strong>
          </div>
          <div>
            <span>REASON</span>
            <strong style={{ fontSize: 13, fontFamily: "var(--font-sans, inherit)", fontWeight: 400, color: "#c9cbbf" }}>Tests the approval flow only. Executes nothing.</strong>
          </div>
        </div>
        <div className="sn-wallet-foot">
          <span>require_approval: true</span>
          <span>MCP</span>
        </div>
      </div>
      <div className="sn-mandate-card">
        <div className="sn-mandate-top"><span>GRANT</span><b>ONE USE</b></div>
        <div className="sn-mandate-title">after approval</div>
        <div className="sn-mandate-meta">
          <span style={{ color: "var(--text-secondary)" }}>bound to</span><strong>tool · server · args</strong>
          <span style={{ color: "var(--text-secondary)" }}>uses</span><strong>1</strong>
          <span style={{ color: "var(--text-secondary)" }}>expires</span><strong>yes</strong>
        </div>
        <div className="sn-mandate-proof"><i /> CHANGED ARGUMENTS ARE REFUSED</div>
      </div>
      <figcaption className="sn-wallet-caption sn-mono" style={{ color: "var(--text-secondary)" }}>Illustrative · synthetic action</figcaption>
    </figure>
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

      {/* Announcement ribbon: the monthly live session, for visitors not yet ready for a wallet */}
      <OperatorsHourRibbon serverDate={formatSessionDate(nextOperatorsHour())} />

      {/* Nav */}
      <nav style={{ position: "sticky", top: 0, zIndex: 40, background: "rgba(251,250,246,.8)", backdropFilter: "blur(12px)", borderBottom: "1px solid var(--line-2)" }}>
        <div style={{ ...wrap, display: "flex", alignItems: "center", gap: 32, height: 64 }}>
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 600, fontSize: 17, letterSpacing: "-0.02em" }}>
            <img src="/brand/sanction-wordmark-green.svg" alt="Sanction" style={{ height: 25 }} />
            <span className="sn-lockup-tag" aria-hidden="true"><span>Agent authorization</span></span>
          </Link>
          <div className="sn-nav-links" style={{ display: "flex", gap: 24, fontSize: 14, marginLeft: 16, whiteSpace: "nowrap" }}>
            <a className="sanction-link" href="#how">How it works</a>
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
            <MonoLabel mb={20}>One-off human approvals for AI agents</MonoLabel>
            <h1 className="sn-hero-h1" style={{ margin: 0, font: "var(--text-display)", letterSpacing: "var(--tracking-display)" }}>
              Let your agent ask before it acts.
            </h1>
            <p style={{ font: "var(--text-body-l)", color: "var(--text-secondary)", maxWidth: "52ch", margin: "24px 0 32px" }}>
              Your agent proposes an exact action. An authorized person approves or rejects it. If
              approved, the agent redeems an expiring, one-use grant for that identical action
              before it proceeds, from the AI tools you already use.
            </p>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <Link className="sn-btn sn-btn-primary sn-btn-l" href="/docs/connect">Try one approval</Link>
              <Link className="sn-btn sn-btn-secondary sn-btn-l" href="/start">Start free</Link>
            </div>
            <p style={{ margin: "16px 0 0", fontSize: 13.5, color: "var(--text-secondary)" }}>
              Free for individuals. No card. The first request is synthetic and executes nothing.
            </p>
          </div>
          <ApprovalVisual />
        </div>
      </header>

      {/* The approval loop */}
      <section id="how" style={{ ...wrap, padding: "96px 32px 104px" }}>
        <div style={{ maxWidth: 640, marginBottom: 48 }}>
          <MonoLabel mb={16}>How one approval works</MonoLabel>
          <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>
            Exact request. Human decision. One-use grant.
          </h2>
          <p style={{ font: "var(--text-body-l)", color: "var(--text-secondary)", maxWidth: "56ch", margin: "20px 0 0" }}>
            If you&apos;re not sure, Sanction it. The agent asks before a step it should not take
            alone, waits for a person, and continues only with a grant for exactly what was reviewed.
          </p>
        </div>
        <ol className="sn-cards" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {LOOP.map(([n, t, d]) => (
            <li key={n} style={{ borderTop: "1px solid var(--line-1)", paddingTop: 20 }}>
              <MonoLabel color="var(--pine-7)">Step {n}</MonoLabel>
              <h3 style={{ margin: "10px 0 8px", font: "var(--text-h3)" }}>{t}</h3>
              <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55, color: "var(--text-secondary)" }}>{d}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Synthetic example + connection paths */}
      <section id="try" style={{ borderTop: "1px solid var(--line-2)", background: "var(--surface-sunken)" }}>
        <div style={{ ...wrap, padding: "96px 32px 104px" }}>
          <div className="sn-mcp-panel">
            <div>
              <MonoLabel mb={16}>Try it safely</MonoLabel>
              <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>
                Your first request executes nothing.
              </h2>
              <p style={{ font: "var(--text-body-l)", color: "var(--text-secondary)", maxWidth: "52ch", margin: "20px 0 24px" }}>
                The connection guide walks a synthetic request through the whole loop: ask, review,
                check once, redeem once. On a denial, an expired or reused grant, or an unclear
                result, the agent stops and reports. It does not retry with altered arguments or
                ask again on its own.
              </p>
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <Link className="sn-btn sn-btn-primary sn-btn-m" href="/docs/connect">Open the connection guide →</Link>
                <Link className="sanction-link" href="/docs/mcp-oauth" style={{ fontSize: 14 }}>Decision contract details</Link>
              </div>
            </div>
            <figure className="sn-mcp-code" data-theme="dark" style={{ margin: 0 }} aria-label="Illustrative synthetic approval sequence">
              <div className="sn-mcp-window"><i /><i /><i /><span>Illustrative · synthetic</span></div>
              {EXAMPLE_LINES.map(([mark, line], i) => (
                <code key={i} style={{ whiteSpace: "normal", overflowWrap: "anywhere", lineHeight: 1.7, padding: "3px 0" }}><b>{mark || "\u00a0"}</b>{line}</code>
              ))}
              <code className="sn-code-result">SYNTHETIC · NOTHING EXECUTED</code>
            </figure>
          </div>

          <div style={{ maxWidth: 640, margin: "88px 0 32px" }}>
            <MonoLabel mb={16}>Choose a connection</MonoLabel>
            <h2 style={{ margin: 0, font: "var(--text-h2)", letterSpacing: "var(--tracking-heading)" }}>
              Two MCP profiles, one decision engine.
            </h2>
          </div>
          <div className="sn-pair">
            <div className="sn-card" style={{ padding: 28 }}>
              <MonoLabel color="var(--pine-7)">Approvals profile · recommended for AI hosts</MonoLabel>
              <h3 style={{ margin: "12px 0 8px", font: "var(--text-h3)" }}>Approvals over OAuth</h3>
              <p style={{ margin: "0 0 14px", fontSize: 14.5, lineHeight: 1.55, color: "var(--text-secondary)" }}>
                Eight tools for authorization requests, decision checks, wallet status, and
                usage and outcome logging. No execution-token issuance or credential retrieval.
                Hosts connect with OAuth; API-key access is also supported.
              </p>
              <code style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: 13, overflowWrap: "anywhere", color: "var(--text-body)" }}>https://getsanction.com/mcp/approvals</code>
              <p style={{ margin: "14px 0 0", fontSize: 14 }}>
                <Link className="sanction-link" href="/docs/connect">Setup steps and dated test status per host →</Link>
              </p>
            </div>
            <div className="sn-card" style={{ padding: 28 }}>
              <MonoLabel color="var(--pine-7)">Full wallet profile · for developers</MonoLabel>
              <h3 style={{ margin: "12px 0 8px", font: "var(--text-h3)" }}>Wallet over API key</h3>
              <p style={{ margin: "0 0 14px", fontSize: 14.5, lineHeight: 1.55, color: "var(--text-secondary)" }}>
                Ten tools: the approvals set plus scoped execution tokens and credential retrieval
                from the encrypted vault. Uses an agent API key, over remote MCP or the stdio package.
              </p>
              <code style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: 13, overflowWrap: "anywhere", color: "var(--text-body)" }}>https://getsanction.com/mcp · npx sanction-mcp</code>
              <p style={{ margin: "14px 0 0", fontSize: 14 }}>
                <Link className="sanction-link" href="/docs/agent-wallet">Read the wallet architecture →</Link>
              </p>
            </div>
          </div>
          <p style={{ margin: "20px 0 0", fontSize: 13.5, color: "var(--text-secondary)", maxWidth: "70ch" }}>
            MCP URLs are protocol endpoints for AI hosts, not pages to open in a browser. A custom
            connection is not a directory listing; the connection guide records each host&apos;s
            evidence separately.
          </p>
        </div>
      </section>

      {/* Workflows */}
      <section id="workflows" style={{ borderTop: "1px solid var(--line-2)" }}>
        <div style={{ ...wrap, padding: "96px 32px 112px" }}>
          <div style={{ maxWidth: 620, marginBottom: 48 }}>
            <MonoLabel mb={16}>Beyond one-off approvals</MonoLabel>
            <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>
              Budgets, a broker, and x402 when you need them.
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
      <section id="policy" style={{ borderTop: "1px solid var(--line-2)", background: "var(--surface-sunken)" }}>
        <div style={{ ...wrap, padding: "112px 32px" }}>
        <div style={{ maxWidth: 620, marginBottom: 48 }}>
          <MonoLabel mb={16}>When you want policy</MonoLabel>
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
              <code><em>✓</em> 10 tools · full wallet profile</code>
              <code><b>→</b> sanction_authorize_tool</code>
              <code className="sn-code-result">ILLUSTRATIVE · request dec_8f31</code>
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
          <MonoLabel mb={16}>Start with one approval</MonoLabel>
          <h2 style={{ margin: 0, font: "var(--text-h2)", letterSpacing: "var(--tracking-heading)" }}>
            If you&apos;re not sure, Sanction it.
          </h2>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginTop: 28 }}>
            <Link className="sn-btn sn-btn-primary sn-btn-l" href="/docs/connect">Try one approval</Link>
            <Link className="sn-btn sn-btn-secondary sn-btn-l" href="/start">Start free</Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ borderTop: "1px solid var(--line-2)" }}>
        <div style={{ ...wrap, display: "flex", alignItems: "center", gap: 24, padding: 32, fontSize: 13, color: "var(--text-muted)", flexWrap: "wrap" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, color: "var(--text-body)" }}>
            <img src="/brand/sanction-wordmark-green.svg" alt="Sanction" style={{ height: 18 }} />
          </span>
          <span>One-off human approvals for AI agent actions.</span>
          <span style={{ marginLeft: "auto", display: "flex", gap: 20, flexWrap: "wrap" }}>
            <Link className="sanction-link" href="/docs/connect">Connect</Link>
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
