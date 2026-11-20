import type { Metadata } from "next"
import { Suspense } from "react"
import { SignInRecovery } from "@/components/signin-recovery"
import Link from "next/link"
import "./brand.css"
import "./home.css"
import { brandFontVars } from "./brand-fonts"
import { OperatorsHourRibbon } from "@/components/operators-hour-ribbon"
import { formatSessionDate, nextOperatorsHour } from "@/lib/operatorsHour"
import { FOUNDER_NOTE } from "./about/founder-note"
import { HEROES, HOSTS, POSITIONING } from "./home-copy"

export const revalidate = 3600

const hero = HEROES[POSITIONING]

export const metadata: Metadata = {
  title: `Sanction — ${hero.headline.replace(/\.$/, "")}`,
  description: "When an AI agent reaches a step that needs you, it asks. Approve or reject that exact action in Sanction or Slack. Try one approval without an account. Free for individuals.",
  alternates: { canonical: "/" },
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

const outcomes: { tone: "allowed" | "refused"; verdict: string; title: string; request: React.ReactNode; body: string }[] = [
  { tone: "allowed", verdict: "Allowed", title: "The request you approved", request: <>deploy revision a1b2c3d{"\n"}to production</>, body: "Runs once, before the permission expires." },
  { tone: "refused", verdict: "Refused", title: "A request that changed", request: <>deploy revision <mark>f9e8d7c</mark>{"\n"}to production</>, body: "Different inputs need a new decision." },
  { tone: "refused", verdict: "Refused", title: "The same approval, twice", request: <>deploy revision a1b2c3d{"\n"}to production <mark>(again)</mark></>, body: "A permission works once. The second attempt is refused." },
]

const does = [
  "Pause an agent at the step you chose and wait for a person.",
  "Tie each approval to one exact request, once.",
  "Keep a record of who asked and who decided.",
  "Enforce before execution on paths routed through the tool broker or the model gateway.",
]

const doesNot = [
  "Intercept tools that never call it. A connected agent has to ask.",
  "Prove an outside action ran. The record shows what was authorized.",
  "Replace your AI tool’s own permission settings.",
]

const teams = [
  ["Budgets by team", "A cap on the company applies to every team inside it. A team can tighten its own rules, never loosen them."],
  ["Model spend, held before the call", "Point model traffic at the gateway. It sets budget aside before each call, so calls running at the same time can’t spend the same dollars."],
  ["Approvals where the team already works", "Requests arrive in a Slack channel, and the record names the person who decided."],
]

function Label({ children }: { children: React.ReactNode }) {
  return <p className="sn-mono sn-home-label">{children}</p>
}

function Mark({ yes }: { yes: boolean }) {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={yes ? "var(--pine-7)" : "#7d2f1f"} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      {yes ? <path d="M4 10.5l4 4 8-9" /> : <path d="M5 5l10 10M15 5L5 15" />}
    </svg>
  )
}

function ApprovalVisual() {
  return (
    <figure className="sn-review-example" aria-label="Illustrative deployment approval request. No live action.">
      <div className="sn-review-top"><span>YOUR APPROVAL INBOX</span><span className="sn-review-status">Waiting for review</span></div>
      <div className="sn-review-body">
        <p className="sn-review-from">From your coding agent</p>
        <h2>Ready to deploy.<br />May I proceed?</h2>
        <dl className="sn-review-details">
          <div><dt>Action</dt><dd>Deploy the website update</dd></div>
          <div><dt>Destination</dt><dd>Production website</dd></div>
          <div><dt>Release</dt><dd>Reviewed revision a1b2c3d</dd></div>
          <div><dt>Permission</dt><dd>This exact action, once</dd></div>
        </dl>
        <div className="sn-review-choices" aria-label="Illustrative decision choices, not interactive controls"><span>Approve once</span><span>Reject</span></div>
      </div>
      <figcaption>Illustrative example. The same request arrives in Slack when connected.</figcaption>
    </figure>
  )
}

export default function Landing() {
  return (
    <main className={`sanction sn-home sn-hp ${brandFontVars}`}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <OperatorsHourRibbon serverDate={formatSessionDate(nextOperatorsHour())} />
      <nav className="sn-home-nav" aria-label="Main navigation">
        <div className="sn-home-wrap sn-home-nav-inner">
          <Link href="/" aria-label="Sanction home"><img src="/brand/sanction-wordmark-green.svg" alt="Sanction" width="130" height="25" /></Link>
          <div className="sn-home-nav-links">
            <a href="#how">How it works</a><Link href="/install">Connect</Link><a href="#teams">For teams</a><a href="#pricing">Pricing</a><Link href="/docs">Docs</Link>
          </div>
          <div className="sn-home-nav-actions"><Link className="sn-btn sn-btn-ghost sn-btn-s" href="/login">Sign in</Link><Link className="sn-btn sn-btn-primary sn-btn-s" href="/start">Try one approval</Link></div>
        </div>
      </nav>

      <div className="sn-home-wrap"><Suspense fallback={null}><SignInRecovery /></Suspense></div>

      <header className="sn-home-hero">
        <div className="sn-home-wrap sn-home-hero-grid">
          <div>
            <Label>Human approval for AI agents</Label>
            <h1 className="sn-hero-h1">{hero.headline}</h1>
            <p className="sn-home-lead">{hero.lead}</p>
            <div className="sn-home-actions"><Link className="sn-btn sn-btn-primary sn-btn-l" href="/start">Try one approval</Link><Link className="sn-btn sn-btn-secondary sn-btn-l" href="/install">Connect your AI tool</Link></div>
            <p className="sn-home-small">Try it without an account. Free for individuals, including production and client work. No card.</p>
          </div>
          <ApprovalVisual />
        </div>
      </header>

      <section id="hosts" className="sn-hp-band" aria-labelledby="hosts-title">
        <div className="sn-home-wrap sn-home-section">
          <div className="sn-home-section-heading"><Label>One inbox, every tool</Label><h2 id="hosts-title">Your providers stay yours. The decisions come to one place.</h2><p>Approvals built into one AI tool stop at that tool. Sanction gives every agent the same way to ask, and gives you one record of what you decided.</p></div>
          <ul className="sn-hp-hosts">
            {HOSTS.map(host => <li key={host.name}><strong>{host.name}</strong><span className="sn-hp-pill" data-tone={host.tone}>{host.status}</span></li>)}
          </ul>
          <p className="sn-hp-note">Each status is dated in the <Link href="/docs/connect">connection guide</Link>. <Link href="/install">See setup for your tool</Link></p>
        </div>
      </section>

      <section className="sn-home-section sn-home-wrap" aria-labelledby="exact-title">
        <div className="sn-home-section-heading"><Label>What a yes means</Label><h2 id="exact-title">Approve the exact action, not the agent.</h2><p>Your approval becomes a permission for one request with its exact inputs. It expires, and it works once.</p></div>
        <div className="sn-hp-cards">
          {outcomes.map(outcome => <article className="sn-hp-card" key={outcome.title}><span className="sn-hp-pill" data-tone={outcome.tone}>{outcome.verdict}</span><h3>{outcome.title}</h3><p className="sn-hp-request">{outcome.request}</p><p>{outcome.body}</p></article>)}
        </div>
      </section>

      <section id="how" className="sn-home-how">
        <div className="sn-home-wrap sn-home-section">
          <div className="sn-home-section-heading"><Label>How it works</Label><h2>A clear pause. A specific yes or no.</h2></div>
          <ol className="sn-home-steps">
            <li><span>01</span><h3>The agent brings the details</h3><p>What it wants to do, where, and with which inputs. The exact request defines what you approve.</p></li>
            <li><span>02</span><h3>You review and decide</h3><p>Approve or reject in the inbox, or in Slack when connected. Your organization’s rules still apply; an approval cannot override a hard denial.</p></li>
            <li><span>03</span><h3>It resumes that exact action</h3><p>The agent redeems its one-use permission and continues. A rejection or an expired permission means stop.</p></li>
          </ol>
        </div>
      </section>

      <section className="sn-home-section sn-home-wrap" aria-labelledby="limits-title">
        <div className="sn-home-section-heading"><Label>Straight answers</Label><h2 id="limits-title">What Sanction does, and what it doesn’t.</h2><p>Can an agent skip Sanction? On a plain connection, yes: the agent has to ask. When that isn’t enough, route the action through Sanction and it is enforced before it runs.</p></div>
        <div className="sn-hp-pair">
          <article className="sn-hp-card"><h3>It does</h3><ul className="sn-hp-list">{does.map(item => <li key={item}><Mark yes /><span>{item}</span></li>)}</ul></article>
          <article className="sn-hp-card"><h3>It doesn’t</h3><ul className="sn-hp-list">{doesNot.map(item => <li key={item}><Mark yes={false} /><span>{item}</span></li>)}</ul></article>
        </div>
        <p className="sn-hp-takeaway">Start with a connection that asks. Add enforcement on the paths where asking isn’t enough. <Link href="/platform#how">How enforcement works</Link></p>
      </section>

      <section id="teams" className="sn-hp-band" aria-labelledby="teams-title">
        <div className="sn-home-wrap sn-home-section sn-hp-teams">
          <div className="sn-home-section-heading"><Label>For teams</Label><h2 id="teams-title">Govern your company’s own AI use.</h2><p>Give each team a budget and its own rules. Limits set at the top apply to everyone below, and each team sees what its agents asked for and spent.</p><Link className="sn-btn sn-btn-secondary sn-btn-m" href="/platform">See the platform</Link></div>
          <div className="sn-hp-stack">{teams.map(([title, body]) => <article key={title}><h3>{title}</h3><p>{body}</p></article>)}</div>
        </div>
      </section>

      {FOUNDER_NOTE && (
        <section className="sn-hp-why" aria-labelledby="why-title">
          <div><Label>Why Sanction exists</Label><h2 id="why-title">{FOUNDER_NOTE.headline}</h2>{FOUNDER_NOTE.paragraphs.slice(0, 1).map(paragraph => <p key={paragraph}>{paragraph}</p>)}<Link href="/about">Read the story</Link></div>
        </section>
      )}

      <section id="pricing" className="sn-home-section sn-home-wrap" aria-labelledby="pricing-title">
        <div className="sn-home-section-heading"><Label>Pricing</Label><h2 id="pricing-title">It’s free, or it’s an agreement.</h2></div>
        <div className="sn-hp-pricing">
          <article><h3>Individual</h3><p className="sn-hp-price">Free</p><p>No card. Personal, production and client work.</p><Link className="sn-btn sn-btn-primary sn-btn-m" href="/start#create-account">Create a free account</Link></article>
          <article><h3>Organization</h3><p className="sn-hp-price">Agreement</p><p>Teams, shared budgets and enforcement, on terms we work out together.</p><Link className="sn-btn sn-btn-secondary sn-btn-m" href="/platform#pricing">How an agreement works</Link></article>
        </div>
      </section>

      <section className="sn-home-closing"><div className="sn-home-wrap"><h2>If you’re not sure, Sanction it.</h2><p>One safe request. A human decision. A clear next step.</p><div className="sn-home-actions"><Link className="sn-btn sn-btn-primary sn-btn-l" href="/start">Try one approval</Link><Link className="sn-btn sn-btn-secondary sn-btn-l" href="/install">Connect your AI tool</Link></div></div></section>
      <footer className="sn-home-footer sn-home-wrap"><div><img src="/brand/sanction-wordmark-green.svg" alt="Sanction" width="104" height="20" /><p>Authorize. Protect. Govern.</p></div><nav aria-label="Footer navigation"><Link href="/use-cases">Use cases</Link><Link href="/platform">Platform</Link><Link href="/install">Install</Link><Link href="/docs/connect">Connect</Link><Link href="/slack">Slack</Link><Link href="/about">About</Link><Link href="/roadmap">Roadmap</Link><Link href="/changelog">Changelog</Link><Link href="/support">Support</Link><Link href="/privacy">Privacy</Link></nav></footer>
    </main>
  )
}
