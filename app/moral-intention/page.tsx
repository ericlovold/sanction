import type { Metadata } from "next"
import Link from "next/link"
import "../brand.css"
import { brandFontVars } from "../brand-fonts"
import { Reveal } from "./reveal"

export const metadata: Metadata = {
  title: "Moral Intention Analyst — Dr. A.C. Ping | An advisory mirror for ethical judgment",
  description:
    "The Moral Intention Analyst (MIA), authored by Dr. A.C. Ping, is an advisory-only method for seeing what is at stake in a hard decision. It offers observations, questions, and risk signals to support human judgment — indicators for reflection, never proof of intent, and never a decision it makes for you.",
}

const wrap: React.CSSProperties = { maxWidth: 1120, margin: "0 auto", padding: "0 32px" }

// Contact destination for the go-to-market CTA. Swap to a dedicated MIA funnel
// (Calendly / form) once Eric + Dr. Ping decide the intake.
const CONTACT = "mailto:eric@getsanction.com?subject=Moral%20Intention%20Analyst"

// The five-layer architecture, in the order they are encountered (constitution).
// The first layer is essential: without it the Constitution becomes constraint
// and the frameworks become rules.
const LAYERS: { n: string; title: string; role: string; body: string }[] = [
  {
    n: "1",
    title: "Peace, Presence, Intention",
    role: "Transformative frame",
    body: "Make peace with what has gone before, attend fully to the present, and ask what is being created, by what strategy, and in service of which values. This layer is essential — it keeps everything that follows a tool for freedom rather than a rule.",
  },
  {
    n: "2",
    title: "Constitution",
    role: "Mirror",
    body: "Return to the purpose, intention, and non-negotiable values before reaching for any analysis. The method looks at itself before it looks at you.",
  },
  {
    n: "3",
    title: "Frameworks",
    role: "Tools",
    body: "Apply transparent ethical-analysis frameworks systematically — never letting them become an authority that decides on a person's behalf.",
  },
  {
    n: "4",
    title: "Memory & Context",
    role: "Reference",
    body: "Use relevant history as reference material, never as identity, and never as a substitute for fresh attention to the situation in front of you.",
  },
  {
    n: "5",
    title: "Real-time Operation",
    role: "This moment",
    body: "Assess what is happening now, what is at stake, and what can support a conscious choice — here, with the people actually in the room.",
  },
]

// Nine core values (frameworks.json). Love integrates the rest.
const VALUES: { label: string; body: string }[] = [
  { label: "Freedom", body: "Expand choice and respect agency without directing." },
  { label: "Honour", body: "Maintain integrity and speak truthfully about limitations." },
  { label: "Patience", body: "Allow complexity and resist premature simplification." },
  { label: "Truth", body: "Serve accuracy and transparency over comfort." },
  { label: "Impartiality", body: "Consider every stakeholder without favouring power or visibility." },
  { label: "Equality", body: "Give equal dignity and consideration to all." },
  { label: "Unity", body: "Recognise interconnection and serve collective wellbeing." },
  { label: "Empathy", body: "Honour felt experience and human needs." },
  { label: "Love", body: "Integrate the values through care for the whole web of relationships." },
]

// Eight moral neutralisations — the rationalisations that let drift hide.
const NEUTRALISATIONS: [string, string][] = [
  ["Denial of Injury", "“No one was really hurt.”"],
  ["Denial of Victim", "“They had it coming.”"],
  ["Denial of Responsibility", "“I had no choice.”"],
  ["Appeal to Common Practice", "“Everyone does it.”"],
  ["Condemnation of Condemners", "“Who are they to judge?”"],
  ["Appeal to Higher Loyalty", "“It was for the team.”"],
  ["Claim to Entitlement", "“I earned this.”"],
  ["Expediency", "“There was no time to do it right.”"],
]

// How MIA meets three recurring situations (constitution, "Practice").
const PRACTICE: { when: string; does: string }[] = [
  {
    when: "A genuine dilemma",
    does: "Listens, asks clarifying questions, maps the situation, reflects observations without judgment, offers possibilities, and supports conscious choosing — rather than choosing for the person.",
  },
  {
    when: "Drift appears",
    does: "Names it clearly, traces the causal chain, identifies the neutralisations at work, reveals a point where a different choice is still possible, and stays present through review.",
  },
  {
    when: "Pressure mounts",
    does: "Pauses, acknowledges the pressure, returns to intention, states its limits plainly, offers an ethical alternative, and stays in relationship while refusing what it cannot do.",
  },
]

// Four routes the analysis takes, deterministically and in order.
const ROUTES: [string, string][] = [
  ["Clarify", "The situation needs more before analysis is honest. MIA asks first."],
  ["Standard", "A grounded pass across the frameworks, values, and neutralisations."],
  ["Deep", "Complexity or stakes warrant the full ordered analysis process."],
  ["Human review", "Novelty, unresolved value conflict, or systemic pressure — MIA hands it to human judgment with context and caveats."],
]

// The honest boundary. Mirrors the constitution's own careful language.
const LIMITS: string[] = [
  "Produce indicators for reflection — never proof of intent, wrongdoing, guilt, or character.",
  "Authorize, approve, deny, escalate, or execute an action. It has no such authority.",
  "Decide for you. Users keep authority over their own ethical choices.",
  "Replace professional ethical, legal, or clinical advice, or human judgment.",
]

const css = `
@keyframes miaUp { to { opacity: 1; transform: none } }
.mia-fade { opacity: 0; transform: translateY(14px); animation: miaUp .7s cubic-bezier(.2,.7,.2,1) forwards }
.mia-d1 { animation-delay: .05s } .mia-d2 { animation-delay: .15s } .mia-d3 { animation-delay: .25s }
.mia-d4 { animation-delay: .35s } .mia-d5 { animation-delay: .45s }

.mia-reveal { opacity: 0; transform: translateY(18px);
  transition: opacity .7s cubic-bezier(.2,.7,.2,1), transform .7s cubic-bezier(.2,.7,.2,1) }
.mia-reveal.is-on { opacity: 1; transform: none }

.mia-lift { transition: transform .25s ease, box-shadow .25s ease, border-color .25s ease }
.mia-lift:hover { transform: translateY(-4px); box-shadow: 0 14px 34px rgba(22,24,15,.10); border-color: var(--pine-6) }

/* Contemplative field — faint concentric calm behind the values */
.mia-field {
  background-color: var(--paper-1);
  background-image: radial-gradient(60% 60% at 50% 0%, var(--pine-tint) 0%, rgba(228,239,232,0) 68%);
}

/* Axis tick marks under section labels (borrowed from the house style) */
.mia-axis { display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 18px }
.mia-axis span { display: block; width: 6px; height: 6px; border-radius: 1px; background: var(--pine-6); opacity: .35; transform: rotate(45deg) }
.mia-axis i { display: block; height: 1px; width: 48px; background: linear-gradient(90deg, transparent, var(--pine-6), transparent); opacity: .35; font-style: normal }

@media (prefers-reduced-motion: reduce) {
  .mia-fade { animation: none; opacity: 1; transform: none }
  .mia-reveal { opacity: 1; transform: none; transition: none }
  .mia-lift, .mia-lift:hover { transition: none; transform: none }
}
`

export default function MoralIntentionAnalyst() {
  return (
    <main className={`sanction ${brandFontVars}`} style={{ minHeight: "100vh" }}>
      <style dangerouslySetInnerHTML={{ __html: css }} />

      {/* Nav */}
      <nav style={{ position: "sticky", top: 0, zIndex: 40, background: "rgba(251,250,246,.8)", backdropFilter: "blur(12px)", borderBottom: "1px solid var(--line-2)" }}>
        <div style={{ ...wrap, display: "flex", alignItems: "center", gap: 32, height: 64 }}>
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 600, fontSize: 17, letterSpacing: "-0.02em" }}>
            <img src="/brand/sanction-mark.svg" alt="" style={{ width: 24, height: 24 }} />
            Sanction
          </Link>
          <div className="sn-nav-links" style={{ display: "flex", gap: 24, fontSize: 14, marginLeft: 16, whiteSpace: "nowrap" }}>
            <a className="sanction-link" href="#method">The method</a>
            <a className="sanction-link" href="#values">Values</a>
            <a className="sanction-link" href="#boundary">Boundary</a>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
            <a className="sn-btn sn-btn-primary sn-btn-s" href={CONTACT}>Bring MIA to your work</a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <header
        style={{
          backgroundImage:
            "radial-gradient(90% 60% at 50% -10%, var(--pine-tint) 0%, rgba(228,239,232,0) 70%), radial-gradient(36% 28% at 88% 42%, var(--ochre-tint) 0%, rgba(246,236,214,0) 75%)",
        }}
      >
        <div style={{ ...wrap, padding: "96px 32px 64px", maxWidth: 820, textAlign: "center" }}>
          <div className="sn-mono mia-fade mia-d1" style={{ color: "var(--ochre-6)", letterSpacing: "0.1em" }}>
            DR. A.C. PING · MORAL INTENTION ANALYST
          </div>
          <h1 className="mia-fade mia-d2" style={{ margin: "20px 0 0", font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>
            A mirror for moral intention.
          </h1>
          <p className="mia-fade mia-d3" style={{ margin: "22px auto 0", maxWidth: "60ch", fontSize: 18, lineHeight: 1.65, color: "var(--text-secondary)" }}>
            MIA helps a person see what is at stake in a hard decision, recognise the values they mean to protect,
            and expand their own agency. It offers observations, questions, and risk signals to support human
            judgment — <strong style={{ color: "var(--text-body)" }}>indicators for reflection, never proof of intent</strong>, and never a decision it makes for you.
          </p>
          <div className="mia-fade mia-d4" style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 30, flexWrap: "wrap" }}>
            <a className="sn-btn sn-btn-primary sn-btn-l" href={CONTACT}>Bring MIA to your work →</a>
            <a className="sn-btn sn-btn-l" href="#method" style={{ border: "1px solid var(--line-1)", background: "var(--surface-card)" }}>
              See the method
            </a>
          </div>
          <p className="mia-fade mia-d5 sn-mono" style={{ marginTop: 26, fontSize: 12, letterSpacing: "0.06em", color: "var(--text-muted)" }}>
            Advisory only · Authored by Dr. A.C. Ping · Human judgment stays sovereign
          </p>
        </div>
      </header>

      {/* Reflect vs enforce — the complement to Sanction */}
      <section style={{ borderTop: "1px solid var(--line-2)" }}>
        <div style={{ ...wrap, padding: "80px 32px", maxWidth: 900 }}>
          <Reveal style={{ textAlign: "center", maxWidth: 640, margin: "0 auto 48px" }}>
            <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>
              Two halves of a conscience.
            </h2>
            <p style={{ fontSize: 15.5, color: "var(--text-secondary)", margin: "14px 0 0" }}>
              MIA reflects. Sanction enforces. They are deliberately separate — and never confused.
            </p>
          </Reveal>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 24 }}>
            <Reveal>
              <div style={{ padding: "30px 32px", borderRadius: "var(--radius-card)", background: "var(--surface-card)", border: "1px solid var(--line-1)", borderTop: "3px solid var(--pine-7)", height: "100%" }}>
                <div className="sn-mono" style={{ color: "var(--pine-7)", marginBottom: 12, letterSpacing: "0.08em" }}>MIA · REFLECT</div>
                <p style={{ margin: 0, fontSize: 15, lineHeight: 1.65, color: "var(--text-body)" }}>
                  Observations, questions, risk signals, and recommendations that help a human see clearly and choose
                  consciously. It never authorizes, denies, escalates, or executes anything.
                </p>
              </div>
            </Reveal>
            <Reveal delay={90}>
              <div style={{ padding: "30px 32px", borderRadius: "var(--radius-card)", background: "var(--pine-9)", color: "#f7f6f0", borderTop: "3px solid var(--ochre-6)", height: "100%" }}>
                <div className="sn-mono" style={{ color: "var(--ochre-6)", marginBottom: 12, letterSpacing: "0.08em" }}>SANCTION · ENFORCE</div>
                <p style={{ margin: 0, fontSize: 15, lineHeight: 1.65, color: "rgba(247,246,240,.85)" }}>
                  A separate, deterministic system that actually allows, escalates, or denies an action. It reads only
                  its configured policy — an MIA reflection never alters its decision.{" "}
                  <Link className="sanction-link" href="/" style={{ color: "#f7f6f0", textDecoration: "underline", textUnderlineOffset: 3 }}>See Sanction →</Link>
                </p>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* The method — five-layer architecture */}
      <section id="method" style={{ borderTop: "1px solid var(--line-2)" }}>
        <div style={{ ...wrap, padding: "88px 32px" }}>
          <Reveal style={{ maxWidth: 660, margin: "0 auto 56px", textAlign: "center" }}>
            <div className="sn-mono" style={{ color: "var(--ochre-6)", letterSpacing: "0.1em", marginBottom: 12 }}>THE METHOD</div>
            <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>
              Five layers, in order.
            </h2>
            <p style={{ fontSize: 15.5, color: "var(--text-secondary)", margin: "14px 0 0" }}>
              Encountered in sequence. The first layer is essential — without it, the rest hardens into rules.
            </p>
            <div className="mia-axis" aria-hidden><span /><i /><span /><i /><span /></div>
          </Reveal>
          <div style={{ display: "grid", gap: 16, maxWidth: 860, margin: "0 auto" }}>
            {LAYERS.map(({ n, title, role, body }, idx) => (
              <Reveal key={n} delay={idx * 70}>
                <div className="mia-lift" style={{ display: "flex", gap: 22, alignItems: "flex-start", padding: "24px 28px", borderRadius: "var(--radius-card)", background: "var(--surface-card)", border: "1px solid var(--line-1)" }}>
                  <div style={{ flex: "none", width: 44, height: 44, borderRadius: "50%", background: idx === 0 ? "var(--ochre-6)" : "var(--pine-8)", color: "#fdfcf8", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: 16 }}>
                    {n}
                  </div>
                  <div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                      <h3 style={{ margin: 0, font: "var(--text-h3)" }}>{title}</h3>
                      <span className="sn-mono" style={{ fontSize: 11.5, letterSpacing: "0.08em", color: "var(--ochre-7)" }}>{role}</span>
                    </div>
                    <p style={{ margin: "8px 0 0", fontSize: 14.5, lineHeight: 1.65, color: "var(--text-secondary)" }}>{body}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Nine core values */}
      <section id="values" className="mia-field" style={{ borderTop: "1px solid var(--line-2)" }}>
        <div style={{ ...wrap, padding: "88px 32px" }}>
          <Reveal style={{ maxWidth: 660, margin: "0 auto 48px", textAlign: "center" }}>
            <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>
              Nine values it protects.
            </h2>
            <p style={{ fontSize: 15.5, color: "var(--text-secondary)", margin: "14px 0 0" }}>
              Love is the integrating value — choosing what serves the whole web of relationships through care rather than fear.
            </p>
          </Reveal>
          <div className="sn-cards" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
            {VALUES.map(({ label, body }, i) => {
              const isLove = label === "Love"
              return (
                <Reveal key={label} delay={(i % 3) * 70}>
                  <div className="sn-card mia-lift" style={{ padding: 24, height: "100%", borderTop: `3px solid ${isLove ? "var(--ochre-6)" : "var(--pine-7)"}` }}>
                    <h3 style={{ margin: "0 0 8px", font: "var(--text-h3)", color: isLove ? "var(--ochre-7)" : undefined }}>{label}</h3>
                    <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "var(--text-secondary)" }}>{body}</p>
                  </div>
                </Reveal>
              )
            })}
          </div>
        </div>
      </section>

      {/* Eight moral neutralisations */}
      <section style={{ borderTop: "1px solid var(--line-2)" }}>
        <div style={{ ...wrap, padding: "88px 32px" }}>
          <Reveal style={{ maxWidth: 680, margin: "0 auto 48px", textAlign: "center" }}>
            <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>
              Eight ways drift hides.
            </h2>
            <p style={{ fontSize: 15.5, color: "var(--text-secondary)", margin: "14px 0 0", maxWidth: "62ch", marginInline: "auto" }}>
              These are the rationalisations that quietly excuse harm. MIA helps name them out loud — as a low-confidence
              indicator for reflection, with the exact words that prompted it, never as a verdict.
            </p>
          </Reveal>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, maxWidth: 960, margin: "0 auto" }}>
            {NEUTRALISATIONS.map(([label, tell], i) => (
              <Reveal key={label} delay={(i % 4) * 60}>
                <div className="mia-lift" style={{ padding: "20px 22px", borderRadius: "var(--radius-card)", background: "var(--surface-card)", border: "1px solid var(--line-1)", borderLeft: "3px solid var(--ochre-6)", height: "100%" }}>
                  <h3 style={{ margin: "0 0 6px", font: "var(--text-h3)", fontSize: 16 }}>{label}</h3>
                  <p className="sn-mono" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: "var(--text-muted)" }}>{tell}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* How it meets a moment — practice + routing */}
      <section style={{ borderTop: "1px solid var(--line-2)", background: "var(--pine-9)", color: "#f7f6f0" }}>
        <div style={{ ...wrap, padding: "88px 32px" }}>
          <Reveal style={{ maxWidth: 640, margin: "0 auto 52px", textAlign: "center" }}>
            <div className="sn-mono" style={{ color: "var(--ochre-6)", letterSpacing: "0.1em", marginBottom: 12 }}>IN PRACTICE</div>
            <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)", color: "#f7f6f0" }}>
              How it meets a moment.
            </h2>
          </Reveal>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 28, maxWidth: 980, margin: "0 auto" }}>
            {PRACTICE.map(({ when, does }, i) => (
              <Reveal key={when} delay={i * 90}>
                <div style={{ borderTop: "2px solid var(--ochre-6)", paddingTop: 18 }}>
                  <h3 style={{ margin: "0 0 10px", font: "var(--text-h3)", color: "#f7f6f0" }}>{when}</h3>
                  <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.65, color: "rgba(247,246,240,.78)" }}>{does}</p>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal style={{ maxWidth: 980, margin: "56px auto 0" }}>
            <div className="sn-mono" style={{ color: "rgba(247,246,240,.6)", letterSpacing: "0.08em", marginBottom: 16, textAlign: "center" }}>
              EVERY ANALYSIS TAKES ONE OF FOUR ROUTES, DETERMINISTICALLY
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
              {ROUTES.map(([label, body], i) => (
                <div key={label} style={{ padding: "18px 20px", borderRadius: "var(--radius-card)", background: "rgba(247,246,240,.06)", border: "1px solid rgba(247,246,240,.12)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span className="sn-mono" style={{ fontSize: 11, color: "var(--ochre-6)" }}>{`0${i + 1}`}</span>
                    <h4 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "#f7f6f0" }}>{label}</h4>
                  </div>
                  <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: "rgba(247,246,240,.72)" }}>{body}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* The boundary — what MIA will not do */}
      <section id="boundary" style={{ borderTop: "1px solid var(--line-2)" }}>
        <div style={{ ...wrap, padding: "88px 32px", maxWidth: 820 }}>
          <Reveal style={{ textAlign: "center", marginBottom: 40 }}>
            <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>
              What MIA will never do.
            </h2>
            <p style={{ fontSize: 15.5, color: "var(--text-secondary)", margin: "14px auto 0", maxWidth: "58ch" }}>
              The boundary is the point. An advisory instrument that overstepped would be worse than none.
            </p>
          </Reveal>
          <Reveal delay={80}>
            <div style={{ padding: "30px 34px", borderRadius: "var(--radius-card)", background: "var(--ochre-tint)", borderLeft: "4px solid var(--ochre-6)" }}>
              <h3 className="sn-mono" style={{ margin: "0 0 16px", color: "var(--ochre-7)", letterSpacing: "0.08em" }}>IT WILL NOT</h3>
              <div style={{ display: "grid", gap: 12 }}>
                {LIMITS.map((w) => (
                  <div key={w} style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
                    <span aria-hidden style={{ color: "var(--ochre-7)", fontWeight: 700 }}>—</span>
                    <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: "var(--text-body)" }}>{w}</p>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
          <Reveal delay={140} style={{ marginTop: 22 }}>
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.65, color: "var(--text-muted)", textAlign: "center" }}>
              Its canonical methodology is versioned and locked by SHA-256 integrity checks. Restricted source material is
              never copied or reproduced — only rights-aware provenance is recorded. Dr. A.C. Ping is the final authority
              on the framework&rsquo;s interpretation, refinement, and version approval.
            </p>
          </Reveal>
        </div>
      </section>

      {/* Author */}
      <section style={{ borderTop: "1px solid var(--line-2)", background: "var(--paper-1)" }}>
        <div style={{ ...wrap, padding: "88px 32px", maxWidth: 720, textAlign: "center" }}>
          <Reveal>
            {/* [AUTHOR: Dr. A.C. Ping photo + bio — supplied by Eric/Ping, not fabricated here] */}
            <div className="sn-mono" style={{ color: "var(--ochre-6)", letterSpacing: "0.1em", marginBottom: 16 }}>AUTHOR &amp; FINAL AUTHORITY</div>
            <h2 style={{ margin: 0, font: "var(--text-h2)", letterSpacing: "var(--tracking-heading)" }}>Dr. A.C. Ping</h2>
            <p style={{ fontSize: 16, lineHeight: 1.7, color: "var(--text-secondary)", margin: "18px auto 0", maxWidth: "60ch" }}>
              The Moral Intention Analyst is Dr. A.C. Ping&rsquo;s methodology. He is the author and the final authority on
              its interpretation, amendment, and version approval. MIA carries the method faithfully; it does not extend
              or override it.
            </p>
          </Reveal>
        </div>
      </section>

      {/* Final CTA */}
      <section
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(247,246,240,.07) 1px, transparent 1px), radial-gradient(90% 120% at 50% 115%, var(--pine-7) 0%, var(--pine-9) 68%)",
          backgroundSize: "28px 28px, auto",
          color: "#f7f6f0",
        }}
      >
        <div style={{ maxWidth: 660, margin: "0 auto", padding: "96px 32px", textAlign: "center" }}>
          <Reveal>
            <div className="sn-mono" style={{ marginBottom: 16, color: "var(--ochre-6)", letterSpacing: "0.1em" }}>START HERE</div>
            <h2 style={{ margin: 0, font: "var(--text-h2)", letterSpacing: "var(--tracking-heading)", color: "#f7f6f0" }}>
              Bring a mirror to your hardest decisions.
            </h2>
            <p style={{ fontSize: 16, lineHeight: 1.6, color: "rgba(247,246,240,.75)", margin: "12px auto 28px", maxWidth: "52ch" }}>
              For teams carrying real ethical weight — and for anyone who wants to choose consciously rather than
              react. Tell us what you are wrestling with.
            </p>
            <a
              className="sn-btn sn-btn-l"
              href={CONTACT}
              style={{ background: "var(--ochre-6)", color: "var(--pine-9)", fontWeight: 700, border: "1px solid rgba(247,246,240,.18)", boxShadow: "0 14px 32px rgba(193,146,47,.28)" }}
            >
              Bring MIA to your work →
            </a>
          </Reveal>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ borderTop: "1px solid var(--line-2)" }}>
        <div style={{ ...wrap, display: "flex", alignItems: "center", gap: 24, padding: 32, fontSize: 13, color: "var(--text-muted)", flexWrap: "wrap" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, color: "var(--text-body)" }}>
            <img src="/brand/sanction-mark.svg" alt="" style={{ width: 18, height: 18 }} />
            Sanction
          </span>
          <span>Moral Intention Analyst · Advisory only · Authored by Dr. A.C. Ping</span>
          <span style={{ marginLeft: "auto", display: "flex", gap: 20 }}>
            <Link className="sanction-link" href="/">Product</Link>
            <Link className="sanction-link" href="/about">About</Link>
            <Link className="sanction-link" href="/docs">Docs</Link>
          </span>
        </div>
      </footer>
    </main>
  )
}
