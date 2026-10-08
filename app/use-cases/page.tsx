import type { Metadata } from "next"
import Link from "next/link"
import { brandFontVars } from "../brand-fonts"
import "../brand.css"
import "./use-cases.css"
import { stories } from "./stories"
import { StoryFilter } from "./story-filter"

export const metadata: Metadata = {
  title: "Ten use cases for human oversight | Sanction",
  description: "Production changes, expenses, messages, scoped access, and agent collaboration: ten ways to review an exact action before it proceeds.",
  alternates: { canonical: "https://getsanction.com/use-cases" },
}

const loop = [
  ["Propose", "An exact action, its arguments, and a reason."],
  ["Decide", "Policy allows, escalates for review, or denies."],
  ["Review", "An authorized person decides an escalated request."],
  ["Redeem", "After human approval, the agent redeems one expiring grant for the same action."],
]

export default function UseCasesPage() {
  return (
    <main className={`sanction uc-page ${brandFontVars}`} id="top">
      <a className="uc-skip" href="#stories">Skip to the stories</a>
      <nav className="uc-nav uc-wrap" aria-label="Main navigation">
        <Link href="/" aria-label="Sanction home"><img src="/brand/sanction-wordmark-green.svg" alt="Sanction" width="130" height="25" /></Link>
        <div><Link href="/platform">Platform</Link><Link href="/docs">Docs</Link><Link className="sn-btn sn-btn-primary sn-btn-s" href="/docs/connect">Try one approval</Link></div>
      </nav>
      <header className="uc-hero uc-wrap">
        <p className="uc-eyebrow">SANCTION / USE CASES</p>
        <h1>Ten moments when<br />someone should ask first.</h1>
        <p className="uc-lede">A production change. An unexpected expense. A message with your name on it. Give the decision a place to happen before the agent proceeds.</p>
        <div className="uc-hero-actions"><a className="sn-btn sn-btn-primary sn-btn-l" href="#stories">Explore the stories <span aria-hidden="true">↓</span></a><a className="uc-text-link" href="#modes">Understand the control boundary</a></div>
        <p className="uc-caption">Five stories for people and engineers. Five for autonomous agents.</p>
      </header>
      <section className="uc-loop-section" aria-labelledby="loop-title">
        <div className="uc-wrap">
          <div className="uc-section-intro"><p className="uc-eyebrow">THE COMMON THREAD</p><h2 id="loop-title">One action. One decision.</h2><p>Start with a one-off approval. Add shared policies, budgets, and scoped access as the work grows.</p></div>
          <ol className="uc-loop">{loop.map(([title, detail], index) => <li key={title}><span className="uc-step-number">0{index + 1}</span><h3>{title}</h3><p>{detail}</p></li>)}</ol>
          <p className="uc-loop-note">Changed arguments require a new decision. Hard limits still deny. Approval does not execute the action; the caller or governed integration takes the next step.</p>
        </div>
      </section>
      <section className="uc-wrap uc-modes" id="modes" aria-labelledby="modes-title">
        <div className="uc-section-intro"><p className="uc-eyebrow">KNOW THE BOUNDARY</p><h2 id="modes-title">The decision is shared.<br />Control depends on the path.</h2></div>
        <div className="uc-mode-grid">
          <article><span className="uc-mode-tag">COOPERATIVE</span><h3>The agent honors the answer.</h3><p>Over the approval connector, an agent asks Sanction, waits when needed, and proceeds only when the response says to proceed. Sanction cannot stop a separate action that bypasses that decision.</p><p className="uc-mode-detail">Approvals connector: <code>/mcp/approvals</code>. An approval gives authority for the matching request, not proof of execution.</p></article>
          <article><span className="uc-mode-tag uc-enforced">ENFORCED PATH</span><h3>The execution path checks the answer.</h3><p>The MCP broker checks governed tool calls before forwarding. The model gateway applies its budget checks before supported provider calls. An SDK integration enforces a decision only when the calling code gates execution on it.</p><p className="uc-mode-detail">The full wallet MCP profile adds tools; connecting it alone does not put downstream actions behind an enforcement boundary.</p></article>
        </div>
      </section>
      <section className="uc-wrap uc-stories" id="stories" aria-labelledby="stories-title">
        <div className="uc-section-intro"><p className="uc-eyebrow">THE STORIES</p><h2 id="stories-title">Where the pause matters.</h2><p>Illustrative scenarios, with the review scope and integration boundary made explicit.</p></div>
        <StoryFilter>
          <nav className="uc-story-index" aria-label="Jump to a story">{stories.map(story => <a key={story.n} href={`#case-${story.n}`} data-track={story.track}><span>{story.n}</span>{story.title}</a>)}</nav>
          <div className="uc-case-list">{stories.map(story => (
            <article className="uc-case" id={`case-${story.n}`} key={story.n} data-track={story.track} aria-labelledby={`title-${story.n}`}>
              <div className="uc-case-meta"><span className="uc-case-number">{story.n}</span><span>{story.track === "people" ? "People & engineers" : "Autonomous agents"}</span><a href={`#case-${story.n}`} aria-label={`Link to story ${story.n}: ${story.title}`}>Link <span aria-hidden="true">↗</span></a></div>
              <h3 id={`title-${story.n}`}>{story.title}</h3>
              <p className="uc-story">{story.story}</p>
              <figure className="uc-diagram">
                <ol>{story.strip.map((step, index) => <li key={step.t} data-tone={"tone" in step ? step.tone : undefined}><span className="uc-node-number">{index + 1}</span><strong>{step.t}</strong><span>{step.s.split("|").join(" · ")}</span></li>)}</ol>
                <figcaption>{"note" in story ? story.note : "Illustrative flow. Policy and the integration path determine the decision."}</figcaption>
              </figure>
              <dl className="uc-reviewed"><dt>What is reviewed</dt><dd>{story.reviewed}</dd></dl>
              <details className="uc-technical"><summary>Technical detail & boundaries</summary><dl><div><dt>Cooperative path</dt><dd>{story.coop}</dd></div><div><dt>Enforced path</dt><dd>{story.enf}</dd></div><div className="uc-boundary"><dt>Boundary</dt><dd>{story.boundary}</dd></div></dl></details>
            </article>
          ))}</div>
        </StoryFilter>
      </section>
      <section className="uc-closing" aria-labelledby="closing-title"><div className="uc-wrap"><p className="uc-eyebrow">START WITH ONE DECISION</p><h2 id="closing-title">If you’re not sure, Sanction it.</h2><p>Connect your agent and walk through a safe approval request. Review the proposal, decide, and see the grant redeemed without running a real action.</p><Link className="sn-btn sn-btn-primary sn-btn-l" href="/docs/connect">Try one approval <span aria-hidden="true">↗</span></Link></div></section>
      <footer className="uc-wrap uc-footer"><Link href="/">Sanction</Link><span>Authorize. Protect. Govern.</span><a href="#top">Back to top ↑</a></footer>
    </main>
  )
}
