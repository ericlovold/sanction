import type { Metadata } from "next"
import Link from "next/link"
import "./brand.css"
import { brandFontVars } from "./brand-fonts"
import { OperatorsHourRibbon } from "@/components/operators-hour-ribbon"
import { formatSessionDate, nextOperatorsHour } from "@/lib/operatorsHour"

export const revalidate = 3600

export const metadata: Metadata = {
  title: "Sanction — Human oversight. Autonomous agents.",
  description: "Review the deployment, expense, or message before your AI agent proceeds. One action, one human decision. Start with a safe approval request. Free for individuals.",
}

const structuredData = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Sanction",
  url: "https://getsanction.com",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web, API",
  description: "Human approvals for AI agent actions, with budgets, scoped access, and an attributable decision record.",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
}

const humanUses = [
  ["01", "Before it goes live", "Your coding agent is ready to deploy. Review the proposed release and destination before authorizing that step.", "Deployments"],
  ["02", "Before it spends", "An agent needs more API credits or a paid tool. Review the amount and purpose before approving the expense.", "Purchases & expenses"],
  ["03", "Before it speaks for you", "The draft is ready. Review the exact message and recipients before your agent sends or publishes it.", "Outbound messages"],
  ["04", "Before access outlives the work", "Give a contractor’s agent its own scoped seat, budget, and expiry date. Keep access tied to the assignment.", "Contractor access"],
  ["05", "When the team uses different AI tools", "Bring agents from different providers under shared approval rules, with separate agent identities and a shared decision history.", "Cross-provider teams"],
]

const agentUses = [
  ["Pause at a budget boundary", "Escalate an expense above the review threshold. Hard budget limits still deny it; a human approval does not raise them."],
  ["Request a new capability", "Ask before acquiring a skill, plugin, or integration. Authorization does not install it."],
  ["Resume the reviewed action", "Redeem a one-use grant for the identical request. Changed arguments require a new decision."],
  ["Keep provider keys out of the agent", "Route supported calls through the broker or model gateway, which adds vaulted credentials on the server."],
  ["Collaborate under its own identity", "Give each agent its own key, scope, and budget so authorization stays attributable across tools."],
]

function Label({ children }: { children: React.ReactNode }) {
  return <p className="sn-mono sn-home-label">{children}</p>
}

function ApprovalVisual() {
  return (
    <figure className="sn-review-example" aria-label="Illustrative deployment approval request. No live action.">
      <div className="sn-review-top"><span>YOUR APPROVAL INBOX</span><span className="sn-review-status">Waiting for review</span></div>
      <div className="sn-review-body">
        <p className="sn-review-from">From your coding agent</p>
        <h2>Ready to deploy.<br />May I proceed?</h2>
        <p>The update is ready for your review. This request covers one deployment to production.</p>
        <dl className="sn-review-details">
          <div><dt>Action</dt><dd>Deploy the website update</dd></div>
          <div><dt>Destination</dt><dd>Production website</dd></div>
          <div><dt>Release</dt><dd>Reviewed revision a1b2c3d</dd></div>
          <div><dt>Permission</dt><dd>This exact action, once</dd></div>
        </dl>
        <div className="sn-review-choices" aria-label="Illustrative decision choices, not interactive controls"><span>Approve once</span><span>Reject</span></div>
        <p className="sn-review-note">You review. The agent waits.</p>
      </div>
      <figcaption>Illustrative example · no deployment or approval occurs here.</figcaption>
    </figure>
  )
}

export default function Landing() {
  return (
    <main className={`sanction sn-home ${brandFontVars}`}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <OperatorsHourRibbon serverDate={formatSessionDate(nextOperatorsHour())} />
      <nav className="sn-home-nav" aria-label="Main navigation">
        <div className="sn-home-wrap sn-home-nav-inner">
          <Link href="/" aria-label="Sanction home"><img src="/brand/sanction-wordmark-green.svg" alt="Sanction" width="130" height="25" /></Link>
          <div className="sn-home-nav-links">
            <Link href="/use-cases">Use cases</Link><a href="#how">How it works</a><Link href="/platform">Platform</Link><Link href="/docs">Docs</Link>
          </div>
          <div className="sn-home-nav-actions"><Link className="sn-btn sn-btn-ghost sn-btn-s" href="/login">Sign in</Link><Link className="sn-btn sn-btn-primary sn-btn-s" href="/docs/connect">Try one approval</Link></div>
        </div>
      </nav>

      <header className="sn-home-hero">
        <div className="sn-home-wrap sn-home-hero-grid">
          <div>
            <Label>A human decision at the moment it matters</Label>
            <h1 className="sn-hero-h1">Human oversight.<br />Autonomous agents.</h1>
            <p className="sn-home-lead">Give your agents room to work and a clear point to bring you in. Review the deployment, the purchase, or the message to a customer before that step proceeds.</p>
            <div className="sn-home-actions"><Link className="sn-btn sn-btn-primary sn-btn-l" href="/docs/connect">Try one approval</Link><a className="sn-btn sn-btn-secondary sn-btn-l" href="#how">See how it works</a></div>
            <p className="sn-home-small">Free for individuals. No card. Your first request executes nothing.</p>
          </div>
          <ApprovalVisual />
        </div>
      </header>

      <div className="sn-home-principles"><div className="sn-home-wrap"><span>Your AI tools</span><span>Your approval rules</span><span>Your decision</span></div></div>

      <section className="sn-home-section sn-home-wrap" aria-labelledby="oversight-title">
        <div className="sn-home-section-heading"><Label>Before you give an agent more responsibility</Label><h2 id="oversight-title">Decide what it can do.<br />Know when you need a say.</h2><p>Your team may work across different AI providers. Give each agent its own limits and bring the decisions into one shared history.</p></div>
        <div className="sn-home-integrations sn-oversight-grid">
          <article><h3>Access: what does it need?</h3><p>Give each agent its own identity and scoped access. Use governed integrations to add credentials without handing the agent your provider keys.</p><Link href="/use-cases#case-04">Scope access to the work →</Link></article>
          <article><h3>Actions: what may it change?</h3><p>Define which tools, capabilities, and expenses are allowed. Route actions through an enforcing integration when the limit must be applied before execution.</p><Link href="/use-cases#case-07">Set boundaries for new capabilities →</Link></article>
          <article><h3>Approval: what needs your review?</h3><p>Review the exact recipient, message, deployment, or expense. Approve that request once, without changing the standing rules.</p><Link href="/use-cases#case-03">Review a message before it leaves →</Link></article>
          <article><h3>Oversight: how do you stay in control?</h3><p>Inspect requests and decisions, track budgets, and revoke access. A decision record shows what was authorized; it does not prove an external action ran.</p><Link href="/use-cases#case-05">Keep a shared decision history →</Link></article>
        </div>
      </section>

      <section id="use-cases" className="sn-home-section sn-home-wrap">
        <div className="sn-home-section-heading"><Label>For the people responsible</Label><h2>Keep the work moving.<br />Keep a say in what happens.</h2><p>Choose the moments that need a person. Connect the relevant workflow so the agent asks before taking that step.</p></div>
        <div className="sn-human-grid">
          {humanUses.map(([number, title, body, category]) => <article className="sn-human-card" key={number}><div className="sn-home-card-label"><span>{category}</span><span>{number}</span></div><h3>{title}</h3><p>{body}</p><Link className="sanction-link" href={`/use-cases#case-${number}`}>Explore this use case →</Link></article>)}
        </div>
        <p className="mt-6"><Link className="sn-btn sn-btn-secondary sn-btn-m" href="/use-cases">Explore all ten use cases →</Link></p>
        <p className="sn-home-small">These workflows require a connected agent or integration. Sanction does not automatically intercept your AI host’s other tools.</p>
      </section>

      <section id="how" className="sn-home-how">
        <div className="sn-home-wrap sn-home-section">
          <div className="sn-home-section-heading"><Label>One request. One decision.</Label><h2>A clear pause.<br />A specific yes or no.</h2><p>Approve the action in front of you without giving the agent blanket permission for whatever comes next.</p></div>
          <ol className="sn-home-steps">
            <li><span>01</span><h3>The agent brings the details</h3><p>What it wants to do, where, and with which inputs. A reason gives you context; the exact request defines what you approve.</p></li>
            <li><span>02</span><h3>You review and decide</h3><p>Approve or reject in the approval inbox, or in Slack when configured. Organizational rules still apply; approval cannot bypass a hard denial.</p></li>
            <li><span>03</span><h3>It resumes that exact action</h3><p>The agent redeems an expiring, one-use permission before proceeding. A changed request, expired permission, or rejection means stop.</p></li>
          </ol>
          <figure className="sn-story-strip" aria-label="Illustrative production change approval sequence">
            <figcaption>One production change, from request to permission</figcaption>
            <ol>
              <li><span>01 · Proposed</span><strong>Deploy this revision</strong><p>The release and destination are specified.</p></li>
              <li><span>02 · Waiting</span><strong>Pause for review</strong><p>The agent requests a human decision.</p></li>
              <li><span>03 · Reviewed</span><strong>You decide</strong><p>Review the exact action and approve or reject it.</p></li>
              <li><span>04 · If approved</span><strong>One-use permission</strong><p>Redeem before expiry. A different action needs a new decision.</p></li>
            </ol>
            <p>Illustrative workflow. Approval records permission; it does not prove the deployment ran.</p>
          </figure>
          <div className="sn-home-next"><p><strong>Start with a harmless request.</strong> The connection guide walks you through a synthetic approval that executes nothing.</p><Link className="sn-btn sn-btn-primary sn-btn-m" href="/docs/connect">Try one approval →</Link></div>
        </div>
      </section>

      <section id="agents" className="sn-home-agents" data-theme="dark">
        <div className="sn-home-wrap sn-home-section sn-home-agent-grid">
          <div className="sn-home-section-heading"><Label>For agents working autonomously</Label><h2>More independence.<br />Clear limits.</h2><p>Give an agent a way to ask for what it needs, respect a refusal, and continue with permission tied to its own identity.</p><Link className="sn-btn sn-btn-onDark sn-btn-m" href="/docs/agent-wallet">Explore the agent wallet →</Link></div>
          <div className="sn-home-agent-list">{agentUses.map(([title, body], index) => <article key={title}><span aria-hidden="true">0{index + 1}</span><div><h3>{title}</h3><p>{body}</p></div></article>)}</div>
        </div>
      </section>

      <section className="sn-home-section sn-home-wrap">
        <div className="sn-home-section-heading"><Label>Fits the way you work</Label><h2>Your providers stay yours.</h2><p>Start with a cooperative approval connection. Add enforcement in the paths you control as your workflow grows.</p></div>
        <div className="sn-home-integrations">
          <article><h3>Connect an AI host</h3><p>Use the approvals connection to request and check decisions. The agent must consult Sanction and honor the response.</p><Link href="/docs/connect">Connection guide & host test status →</Link></article>
          <article><h3>Govern the execution path</h3><p>Route tool calls through the MCP broker, check actions in your application integration, or route model usage through the budget gateway. Enforcement covers those connected paths.</p><Link href="/platform">Explore the platform →</Link></article>
          <article><h3>Keep a decision record</h3><p>See which agent requested an action and how it was authorized. The record evidences the decision; it does not prove an external action ran.</p><Link href="/docs">Read the documentation →</Link></article>
        </div>
      </section>

      <section className="sn-home-closing"><div className="sn-home-wrap"><Label>Start with one approval</Label><h2>If you’re not sure, Sanction it.</h2><p>One safe request. A human decision. A clear next step.</p><div className="sn-home-actions"><Link className="sn-btn sn-btn-primary sn-btn-l" href="/docs/connect">Try one approval</Link><Link className="sn-btn sn-btn-secondary sn-btn-l" href="/start">Create a free account</Link></div></div></section>
      <footer className="sn-home-footer sn-home-wrap"><div><img src="/brand/sanction-wordmark-green.svg" alt="Sanction" width="104" height="20" /><p>Authorize. Protect. Govern.</p></div><nav aria-label="Footer navigation"><Link href="/use-cases">Use cases</Link><Link href="/platform">Platform</Link><Link href="/docs/connect">Connect</Link><Link href="/slack">Slack</Link><Link href="/about">About</Link><Link href="/roadmap">Roadmap</Link><Link href="/changelog">Changelog</Link><Link href="/support">Support</Link><Link href="/privacy">Privacy</Link></nav></footer>
    </main>
  )
}
