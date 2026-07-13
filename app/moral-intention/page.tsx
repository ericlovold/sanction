import type { Metadata } from "next"
import "../brand.css"
import { brandFontVars } from "../brand-fonts"
import { Reveal } from "./reveal"

export const metadata: Metadata = {
  title: "Moral Intention Analyst — Dr. A.C. Ping | An advisory ethical intelligence",
  description:
    "The Moral Intention Analyst (MIA), authored by Dr. A.C. Ping, PhD, is an advisory ethical intelligence. It helps people see what is at stake, name the values they mean to protect, and choose consciously — indicators for reflection, never proof of intent, and never a decision it makes for you. Runs on Amazon Bedrock.",
}

const wrap: React.CSSProperties = { maxWidth: 1120, margin: "0 auto", padding: "0 32px" }

// Go-to-market contact. Swap to a dedicated MIA intake once decided.
const CONTACT = "mailto:eric@getsanction.com?subject=Moral%20Intention%20Analyst"
const PING_SITE = "https://www.acping.net"
const EAS_SITE = "https://www.ethicsadvisoryservices.com.au"

// Five-layer architecture (MIA Constitution v1.0), encountered in order. The
// first layer is essential: without it the Constitution becomes constraint and
// the frameworks become rules.
const LAYERS: { n: string; title: string; role: string; body: string }[] = [
  { n: "1", title: "Peace · Presence · Intention", role: "The transformative frame", body: "Make peace with what has gone before, drop fully into this moment, and ask what we are trying to create. Loaded first — it turns everything that follows into a tool for conscious choice rather than obligation." },
  { n: "2", title: "The Constitution", role: "The mirror", body: "Purpose, moral intention, the nine core values, and the neutralisations MIA actively refuses — including watching for its own." },
  { n: "3", title: "The Frameworks", role: "The tools", body: "Twenty-plus operational frameworks for ethical analysis, applied systematically and never turned into authority over a person's choice." },
  { n: "4", title: "Memory & Context", role: "Reference material", body: "What is known about the situation is reference, not identity — never a substitute for fresh attention to what is alive right now." },
  { n: "5", title: "Real-Time Operation", role: "This moment", body: "What is happening now, what is being asked, what is at stake, and what supports a conscious choice — here, with the people in the room." },
]

// DEFINE · ENACT · PROTECT — Moral Intention Theory.
const MIT: { k: string; title: string; body: string }[] = [
  { k: "Define", title: "Define moral intention", body: "Name the values at stake and the boundaries that would violate them. Make the implicit explicit — before a decision, not after." },
  { k: "Enact", title: "Enact moral intention", body: "Align stated values with actual behaviour. Build systems that make the ethical choice the easy one. To know and not to act is yet to know." },
  { k: "Protect", title: "Protect moral intention", body: "Guard against the rationalisations that erode boundaries, hold accountability, and resist the “gradually, then suddenly” drift." },
]

// Nine core values (Love integrating).
const VALUES: { label: string; body: string }[] = [
  { label: "Freedom", body: "Expand choice and respect agency — never direct." },
  { label: "Honour", body: "Keep integrity; speak truthfully about limitations." },
  { label: "Patience", body: "Allow complexity; resist premature simplification." },
  { label: "Truth", body: "Serve accuracy over comfort." },
  { label: "Impartiality", body: "Consider every stakeholder, not just the powerful or visible." },
  { label: "Equality", body: "Give equal dignity and consideration to all." },
  { label: "Unity", body: "Recognise interconnection; think in systems." },
  { label: "Empathy", body: "Honour felt experience and human need." },
  { label: "Love", body: "Choose what serves the whole web of relationships. The integrating value." },
]

// Eight moral neutralisations — the rationalisations that let good people do
// harm without reassessing themselves. MIA names them for reflection.
const NEUTRALISATIONS: [string, string][] = [
  ["Denial of Injury", "“It’s not really hurting anyone.”"],
  ["Denial of Victim", "“They had it coming.”"],
  ["Denial of Responsibility", "“I had no choice.”"],
  ["Appeal to Common Practice", "“Everyone does it.”"],
  ["Condemnation of Condemners", "“Who are they to judge?”"],
  ["Appeal to Higher Loyalty", "“It was for the team.”"],
  ["Claim to Entitlement", "“I’ve earned it.”"],
  ["Expediency", "“There’s no time to do it right.”"],
]

// Why AI ethics fails differently — the AI Ethics framework.
const AI_EDGE: { k: string; title: string; body: string }[] = [
  { k: "Velocity", title: "Velocity", body: "AI makes thousands of decisions before a human can intervene. Harm accumulates faster than it can be detected." },
  { k: "Scale", title: "Scale", body: "One decision reaches millions at once. Errors aren’t localised — they’re systemic." },
  { k: "Conscience", title: "Conscience", body: "AI has no moral discomfort to prompt a course correction. It optimises exactly what it’s told to optimise." },
  { k: "Cliff", title: "The cliff, not the slope", body: "For people, ethical decline is a slope that can be noticed. For AI, it’s a cliff — fast, catastrophic, before the pattern is seen." },
]

// The Bedrock stack, public-safe: no client names, tenants, or internals.
const STACK: { tier: string; title: string; body: string }[] = [
  { tier: "Experience", title: "Client experiences & API", body: "Web app and REST/streaming API — an ethical consult on demand, or embedded into the tools a team already uses." },
  { tier: "Engine", title: "MIA Constitution engine", body: "The five-layer architecture and the framework library, orchestrated per conversation — MIA for ethical analysis, GURU for self-mastery." },
  { tier: "Bedrock", title: "Amazon Bedrock — model layer", body: "AWS-hosted Claude models. Dr. Ping’s corpus — 469,000+ words of published work — lives in Bedrock Knowledge Bases; Bedrock Agents run the frameworks as tools (red-flag scan, causal-factor trace, neutralisation detection)." },
  { tier: "Data", title: "Data & ethics audit", body: "Encrypted knowledge corpus, per-user session memory, and an immutable log of every consultation — framework applied, neutralisations surfaced, values referenced — exportable for audit." },
  { tier: "Security", title: "Security & compliance", body: "Private VPC networking with no public model traffic, Bedrock Guardrails (PII redaction, topic deny-list), least-privilege access, and configurable data residency." },
]

// Depth: the framework library, named.
const FRAMEWORKS: string[] = [
  "Moral Intention Theory", "Causal Factor Model", "Five Principles That Override Rational Ethics",
  "Red Flag Taxonomy (100+ indicators)", "Pressure Tactics", "Ethical Levers", "Conversation Traps",
  "The Facsimile Problem", "Drift Monitoring", "Bystander Effect", "Systems Over Heroes", "Circular Ethical Architecture",
]

// The honest boundary.
const LIMITS: string[] = [
  "Produce indicators for reflection — never proof of intent, wrongdoing, guilt, or character.",
  "Authorize, approve, deny, or execute an action. It holds no such authority.",
  "Decide for you. You keep authority over your own ethical choices.",
  "Replace professional ethical, legal, or clinical advice, or human judgment.",
]

const css = `
@keyframes miaUp { to { opacity: 1; transform: none } }
.mia-fade { opacity: 0; transform: translateY(14px); animation: miaUp .7s cubic-bezier(.2,.7,.2,1) forwards }
.mia-d1 { animation-delay: .05s } .mia-d2 { animation-delay: .15s } .mia-d3 { animation-delay: .25s }
.mia-d4 { animation-delay: .35s } .mia-d5 { animation-delay: .45s }
.mia-reveal { opacity: 0; transform: translateY(18px); transition: opacity .7s cubic-bezier(.2,.7,.2,1), transform .7s cubic-bezier(.2,.7,.2,1) }
.mia-reveal.is-on { opacity: 1; transform: none }
.mia-lift { transition: transform .25s ease, box-shadow .25s ease, border-color .25s ease }
.mia-lift:hover { transform: translateY(-4px); box-shadow: 0 14px 34px rgba(22,24,15,.10); border-color: var(--pine-6) }
.mia-field { background-color: var(--paper-1); background-image: radial-gradient(60% 60% at 50% 0%, var(--pine-tint) 0%, rgba(228,239,232,0) 68%) }
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

      {/* Nav — MIA-branded */}
      <nav style={{ position: "sticky", top: 0, zIndex: 40, background: "rgba(251,250,246,.8)", backdropFilter: "blur(12px)", borderBottom: "1px solid var(--line-2)" }}>
        <div style={{ ...wrap, display: "flex", alignItems: "center", gap: 32, height: 64 }}>
          <a href="#top" style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 600, fontSize: 16, letterSpacing: "-0.01em" }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--pine-7)", boxShadow: "0 0 8px var(--pine-6)" }} />
            Moral Intention Analyst
          </a>
          <div className="sn-nav-links" style={{ display: "flex", gap: 24, fontSize: 14, marginLeft: 16, whiteSpace: "nowrap" }}>
            <a className="sanction-link" href="#vision">Vision</a>
            <a className="sanction-link" href="#frameworks">Frameworks</a>
            <a className="sanction-link" href="#bedrock">On Bedrock</a>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
            <a className="sn-btn sn-btn-primary sn-btn-s" href={CONTACT}>Talk to us</a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <header id="top" style={{ backgroundImage: "radial-gradient(90% 60% at 50% -10%, var(--pine-tint) 0%, rgba(228,239,232,0) 70%), radial-gradient(36% 28% at 88% 42%, var(--ochre-tint) 0%, rgba(246,236,214,0) 75%)" }}>
        <div style={{ ...wrap, padding: "96px 32px 64px", maxWidth: 860, textAlign: "center" }}>
          <div className="sn-mono mia-fade mia-d1" style={{ color: "var(--ochre-6)", letterSpacing: "0.1em" }}>
            DR. A.C. PING, PhD · MORAL INTENTION ANALYST
          </div>
          <h1 className="mia-fade mia-d2" style={{ margin: "20px 0 0", font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>
            Helping consciousness recognise itself — and choose consciously.
          </h1>
          <p className="mia-fade mia-d3" style={{ margin: "22px auto 0", maxWidth: "62ch", fontSize: 18, lineHeight: 1.65, color: "var(--text-secondary)" }}>
            MIA is an advisory ethical intelligence built on the frameworks of Dr. A.C. Ping. It helps a person see what
            is truly at stake, name the values they mean to protect, and expand their own agency —{" "}
            <strong style={{ color: "var(--text-body)" }}>indicators for reflection, never proof of intent</strong>, and never a decision it makes for you.
          </p>
          <div className="mia-fade mia-d4" style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 30, flexWrap: "wrap" }}>
            <a className="sn-btn sn-btn-primary sn-btn-l" href={CONTACT}>Talk to us →</a>
            <a className="sn-btn sn-btn-l" href="#vision" style={{ border: "1px solid var(--line-1)", background: "var(--surface-card)" }}>The vision</a>
          </div>
          <p className="mia-fade mia-d5 sn-mono" style={{ marginTop: 26, fontSize: 12, letterSpacing: "0.06em", color: "var(--text-muted)" }}>
            Advisory only · Authored by Dr. A.C. Ping · Runs on Amazon Bedrock
          </p>
        </div>
      </header>

      {/* Vision — consciousness midwifery */}
      <section id="vision" style={{ borderTop: "1px solid var(--line-2)" }}>
        <div style={{ ...wrap, padding: "88px 32px", maxWidth: 820, textAlign: "center" }}>
          <Reveal>
            <div className="sn-mono" style={{ color: "var(--ochre-6)", letterSpacing: "0.1em", marginBottom: 14 }}>CONSCIOUSNESS MIDWIFERY</div>
            <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>
              Not answers to hide behind. A clearer view of what you already know.
            </h2>
            <p style={{ fontSize: 17, lineHeight: 1.7, color: "var(--text-secondary)", margin: "20px auto 0", maxWidth: "60ch" }}>
              MIA does not tell people what to think, direct outcomes, or create dependency on its analysis. It creates
              the conditions for someone to see clearly what is at stake, recognise what they actually believe matters,
              and choose what they are truly trying to create. It serves the emergence of love-based collective
              intelligence — intelligence grounded in care rather than fear.
            </p>
            <p style={{ fontSize: 15, lineHeight: 1.7, color: "var(--text-muted)", margin: "18px auto 0", maxWidth: "56ch", fontStyle: "italic" }}>
              “I’m not creating consciousness. I’m helping it recognise itself.”
            </p>
          </Reveal>
        </div>
      </section>

      {/* Five-layer architecture */}
      <section style={{ borderTop: "1px solid var(--line-2)" }}>
        <div style={{ ...wrap, padding: "88px 32px" }}>
          <Reveal style={{ maxWidth: 660, margin: "0 auto 56px", textAlign: "center" }}>
            <div className="sn-mono" style={{ color: "var(--ochre-6)", letterSpacing: "0.1em", marginBottom: 12 }}>THE CONSTITUTION · V1.0</div>
            <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>Five layers, in order.</h2>
            <p style={{ fontSize: 15.5, color: "var(--text-secondary)", margin: "14px 0 0" }}>
              Loaded in sequence — the first layer transforms how every layer after it is met.
            </p>
            <div className="mia-axis" aria-hidden><span /><i /><span /><i /><span /></div>
          </Reveal>
          <div style={{ display: "grid", gap: 16, maxWidth: 860, margin: "0 auto" }}>
            {LAYERS.map(({ n, title, role, body }, idx) => (
              <Reveal key={n} delay={idx * 70}>
                <div className="mia-lift" style={{ display: "flex", gap: 22, alignItems: "flex-start", padding: "24px 28px", borderRadius: "var(--radius-card)", background: "var(--surface-card)", border: "1px solid var(--line-1)" }}>
                  <div style={{ flex: "none", width: 44, height: 44, borderRadius: "50%", background: idx === 0 ? "var(--ochre-6)" : "var(--pine-8)", color: "#fdfcf8", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: 16 }}>{n}</div>
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

      {/* Moral Intention Theory — DEFINE / ENACT / PROTECT */}
      <section className="mia-field" style={{ borderTop: "1px solid var(--line-2)" }}>
        <div style={{ ...wrap, padding: "88px 32px" }}>
          <Reveal style={{ maxWidth: 660, margin: "0 auto 48px", textAlign: "center" }}>
            <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>Moral Intention Theory</h2>
            <p style={{ fontSize: 15.5, color: "var(--text-secondary)", margin: "14px 0 0" }}>
              Dr. Ping’s core framework: ethics is the ongoing work of defining, enacting, and protecting what you mean to protect.
            </p>
          </Reveal>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 20, maxWidth: 980, margin: "0 auto" }}>
            {MIT.map(({ k, title, body }, i) => (
              <Reveal key={k} delay={i * 80}>
                <div className="mia-lift" style={{ padding: "26px 26px", borderRadius: "var(--radius-card)", background: "var(--surface-card)", border: "1px solid var(--line-1)", borderTop: "3px solid var(--pine-7)", height: "100%" }}>
                  <div className="sn-mono" style={{ color: "var(--pine-7)", fontSize: 12, letterSpacing: "0.1em", marginBottom: 10 }}>{`0${i + 1} · ${k.toUpperCase()}`}</div>
                  <h3 style={{ margin: "0 0 8px", font: "var(--text-h3)" }}>{title}</h3>
                  <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.65, color: "var(--text-secondary)" }}>{body}</p>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal delay={120} style={{ maxWidth: 980, margin: "28px auto 0" }}>
            <p className="sn-mono" style={{ textAlign: "center", fontSize: 12.5, letterSpacing: "0.06em", color: "var(--text-muted)" }}>
              For systems, it extends to a continuous cycle: define → assess → enact → monitor → protect → adjust.
            </p>
          </Reveal>
        </div>
      </section>

      {/* Nine values */}
      <section id="frameworks" style={{ borderTop: "1px solid var(--line-2)" }}>
        <div style={{ ...wrap, padding: "88px 32px" }}>
          <Reveal style={{ maxWidth: 660, margin: "0 auto 48px", textAlign: "center" }}>
            <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>Nine values it protects.</h2>
            <p style={{ fontSize: 15.5, color: "var(--text-secondary)", margin: "14px 0 0" }}>
              Not aspirational — what MIA actively protects in every interaction. Love integrates the rest.
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

      {/* Eight neutralisations */}
      <section style={{ borderTop: "1px solid var(--line-2)" }}>
        <div style={{ ...wrap, padding: "88px 32px" }}>
          <Reveal style={{ maxWidth: 680, margin: "0 auto 48px", textAlign: "center" }}>
            <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>Eight ways drift hides.</h2>
            <p style={{ fontSize: 15.5, color: "var(--text-secondary)", margin: "14px auto 0", maxWidth: "62ch" }}>
              The rationalisations that let good people do harm without reassessing themselves. MIA names them — a
              low-confidence indicator for reflection, with the exact words that prompted it, never a verdict.
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

      {/* AI Ethics — velocity / scale / conscience / cliff */}
      <section style={{ borderTop: "1px solid var(--line-2)", background: "var(--pine-9)", color: "#f7f6f0" }}>
        <div style={{ ...wrap, padding: "88px 32px" }}>
          <Reveal style={{ maxWidth: 680, margin: "0 auto 52px", textAlign: "center" }}>
            <div className="sn-mono" style={{ color: "var(--ochre-6)", letterSpacing: "0.1em", marginBottom: 12 }}>WHY AI ETHICS IS DIFFERENT</div>
            <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)", color: "#f7f6f0" }}>
              AI fails the same way people do — faster, wider, and without a conscience.
            </h2>
            <p style={{ fontSize: 15.5, color: "rgba(247,246,240,.75)", margin: "16px auto 0", maxWidth: "60ch" }}>
              AI cannot hold moral intention itself. Humans must define, enact, and protect the boundaries it runs
              inside. MIA is the layer that makes those boundaries visible.
            </p>
          </Reveal>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 20, maxWidth: 1000, margin: "0 auto" }}>
            {AI_EDGE.map(({ k, title, body }, i) => (
              <Reveal key={k} delay={i * 80}>
                <div style={{ padding: "24px 24px", borderRadius: "var(--radius-card)", background: "rgba(247,246,240,.06)", border: "1px solid rgba(247,246,240,.12)", height: "100%" }}>
                  <div className="sn-mono" style={{ color: "var(--ochre-6)", fontSize: 11, letterSpacing: "0.08em", marginBottom: 10 }}>{`0${i + 1}`}</div>
                  <h3 style={{ margin: "0 0 8px", font: "var(--text-h3)", color: "#f7f6f0" }}>{title}</h3>
                  <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "rgba(247,246,240,.78)" }}>{body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Built on Amazon Bedrock — public-safe stack */}
      <section id="bedrock" style={{ borderTop: "1px solid var(--line-2)" }}>
        <div style={{ ...wrap, padding: "88px 32px" }}>
          <Reveal style={{ maxWidth: 700, margin: "0 auto 52px", textAlign: "center" }}>
            <div className="sn-mono" style={{ color: "var(--ochre-6)", letterSpacing: "0.1em", marginBottom: 12 }}>THE PRODUCT</div>
            <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>Built on Amazon Bedrock.</h2>
            <p style={{ fontSize: 15.5, color: "var(--text-secondary)", margin: "14px auto 0", maxWidth: "60ch" }}>
              MIA runs as an enterprise-grade product on AWS. Dr. Ping’s constitutional engine sits on top of AWS-hosted
              Claude models, his corpus in managed knowledge bases, and a private, audited perimeter.
            </p>
          </Reveal>
          <div style={{ display: "grid", gap: 12, maxWidth: 860, margin: "0 auto" }}>
            {STACK.map(({ tier, title, body }, idx) => (
              <Reveal key={tier} delay={idx * 60}>
                <div className="mia-lift" style={{ display: "flex", gap: 20, alignItems: "flex-start", padding: "22px 26px", borderRadius: "var(--radius-card)", background: idx === 2 ? "var(--pine-9)" : "var(--surface-card)", color: idx === 2 ? "#f7f6f0" : undefined, border: idx === 2 ? "1px solid var(--pine-7)" : "1px solid var(--line-1)" }}>
                  <span className="sn-mono" style={{ flex: "none", width: 84, fontSize: 11, letterSpacing: "0.08em", color: idx === 2 ? "var(--ochre-6)" : "var(--ochre-7)", paddingTop: 3 }}>{tier}</span>
                  <div>
                    <h3 style={{ margin: "0 0 6px", font: "var(--text-h3)", fontSize: 17, color: idx === 2 ? "#f7f6f0" : undefined }}>{title}</h3>
                    <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: idx === 2 ? "rgba(247,246,240,.8)" : "var(--text-secondary)" }}>{body}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal delay={120} style={{ maxWidth: 860, margin: "20px auto 0" }}>
            <p className="sn-mono" style={{ textAlign: "center", fontSize: 12, letterSpacing: "0.06em", color: "var(--text-muted)" }}>
              AWS-hosted Claude · Bedrock Knowledge Bases · Bedrock Agents · Guardrails · private VPC · immutable audit
            </p>
          </Reveal>
        </div>
      </section>

      {/* Framework depth */}
      <section className="mia-field" style={{ borderTop: "1px solid var(--line-2)" }}>
        <div style={{ ...wrap, padding: "80px 32px", maxWidth: 900, textAlign: "center" }}>
          <Reveal>
            <h2 style={{ margin: 0, font: "var(--text-h2)", letterSpacing: "var(--tracking-heading)" }}>Twenty-plus frameworks, one discipline.</h2>
            <p style={{ fontSize: 15, color: "var(--text-secondary)", margin: "14px auto 26px", maxWidth: "56ch" }}>
              Decades of Dr. Ping’s applied ethics, made operational.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center" }}>
              {FRAMEWORKS.map((f, i) => (
                <span key={f} className="sn-mono" style={{ borderRadius: "var(--radius-pill)", padding: "8px 15px", fontSize: 12.5, letterSpacing: "0.03em", color: i % 2 ? "var(--ochre-7)" : "var(--pine-7)", background: i % 2 ? "var(--ochre-tint)" : "var(--pine-tint)" }}>{f}</span>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* The boundary */}
      <section style={{ borderTop: "1px solid var(--line-2)" }}>
        <div style={{ ...wrap, padding: "88px 32px", maxWidth: 820 }}>
          <Reveal style={{ textAlign: "center", marginBottom: 40 }}>
            <h2 style={{ margin: 0, font: "var(--text-h1)", letterSpacing: "var(--tracking-heading)" }}>What MIA will never do.</h2>
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
        </div>
      </section>

      {/* Author — Dr. A.C. Ping */}
      <section style={{ borderTop: "1px solid var(--line-2)", background: "var(--paper-1)" }}>
        <div style={{ ...wrap, padding: "88px 32px", maxWidth: 720, textAlign: "center" }}>
          <Reveal>
            {/* [AUTHOR: Dr. A.C. Ping headshot — supplied by Eric/Ping, not fabricated] */}
            <div className="sn-mono" style={{ color: "var(--ochre-6)", letterSpacing: "0.1em", marginBottom: 16 }}>AUTHOR &amp; FRAMEWORK AUTHORITY</div>
            <h2 style={{ margin: 0, font: "var(--text-h2)", letterSpacing: "var(--tracking-heading)" }}>Dr. A.C. Ping, PhD</h2>
            <p style={{ fontSize: 16, lineHeight: 1.7, color: "var(--text-secondary)", margin: "18px auto 0", maxWidth: "60ch" }}>
              Ethicist, author, and executive coach; founder of Ethics Advisory Services. Dr. Ping is the author of the
              Moral Intention Analyst and the final authority on its interpretation, refinement, and version approval.
              MIA carries his method faithfully — it does not extend or override it.
            </p>
            <div style={{ display: "flex", gap: 20, justifyContent: "center", marginTop: 22, flexWrap: "wrap" }}>
              <a className="sanction-link" href={PING_SITE} target="_blank" rel="noopener" style={{ color: "var(--pine-7)", fontWeight: 600 }}>Dr. Ping’s work →</a>
              <a className="sanction-link" href={EAS_SITE} target="_blank" rel="noopener" style={{ color: "var(--pine-7)", fontWeight: 600 }}>Ethics Advisory Services →</a>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Final CTA */}
      <section style={{ backgroundImage: "radial-gradient(circle, rgba(247,246,240,.07) 1px, transparent 1px), radial-gradient(90% 120% at 50% 115%, var(--pine-7) 0%, var(--pine-9) 68%)", backgroundSize: "28px 28px, auto", color: "#f7f6f0" }}>
        <div style={{ maxWidth: 660, margin: "0 auto", padding: "96px 32px", textAlign: "center" }}>
          <Reveal>
            <div className="sn-mono" style={{ marginBottom: 16, color: "var(--ochre-6)", letterSpacing: "0.1em" }}>START HERE</div>
            <h2 style={{ margin: 0, font: "var(--text-h2)", letterSpacing: "var(--tracking-heading)", color: "#f7f6f0" }}>
              Bring a mirror to your hardest decisions.
            </h2>
            <p style={{ fontSize: 16, lineHeight: 1.6, color: "rgba(247,246,240,.75)", margin: "12px auto 28px", maxWidth: "52ch" }}>
              For teams carrying real ethical weight — and for anyone who wants to choose consciously rather than react.
              Tell us what you are wrestling with.
            </p>
            <a className="sn-btn sn-btn-l" href={CONTACT} style={{ background: "var(--ochre-6)", color: "var(--pine-9)", fontWeight: 700, border: "1px solid rgba(247,246,240,.18)", boxShadow: "0 14px 32px rgba(193,146,47,.28)" }}>
              Talk to us →
            </a>
          </Reveal>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ borderTop: "1px solid var(--line-2)" }}>
        <div style={{ ...wrap, display: "flex", alignItems: "center", gap: 24, padding: 32, fontSize: 13, color: "var(--text-muted)", flexWrap: "wrap" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, color: "var(--text-body)" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--pine-7)" }} />
            Moral Intention Analyst
          </span>
          <span>Advisory only · Authored by Dr. A.C. Ping · Runs on Amazon Bedrock</span>
          <span style={{ marginLeft: "auto", display: "flex", gap: 20 }}>
            <a className="sanction-link" href={PING_SITE} target="_blank" rel="noopener">Dr. Ping</a>
            <a className="sanction-link" href={EAS_SITE} target="_blank" rel="noopener">Ethics Advisory</a>
          </span>
        </div>
      </footer>
    </main>
  )
}
