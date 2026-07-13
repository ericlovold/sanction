// Eric's Anthropic credentials (issued Mar 2026) — a light-touch trust strip
// used near the top of the homepage and the consulting page. Clio is noted
// separately below the row. Relies on brand.css tokens, so render inside a
// `sanction`-scoped container.
const CERTS: string[] = [
  "Claude in Amazon Bedrock",
  "Claude Code in Action",
  "MCP: Advanced Topics",
  "Building with the Claude API",
  "AI Fluency: Framework & Foundations",
  "AI Fluency for Educators",
]

export function AnthropicCerts() {
  return (
    <section style={{ borderTop: "1px solid var(--line-2)", background: "var(--pine-tint)" }}>
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "26px 32px", textAlign: "center" }}>
        <div className="sn-mono" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "var(--pine-7)", letterSpacing: "0.12em", fontSize: 12, marginBottom: 14 }}>
          <span aria-hidden style={{ color: "var(--ochre-6)" }}>◆</span> ANTHROPIC CERTIFIED
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
          {CERTS.map((c) => (
            <span key={c} className="sn-mono" style={{ fontSize: 11.5, letterSpacing: "0.02em", color: "var(--text-secondary)", background: "var(--surface-card)", border: "1px solid var(--line-1)", borderRadius: "var(--radius-pill)", padding: "5px 12px" }}>
              {c}
            </span>
          ))}
        </div>
        <p style={{ margin: "14px 0 0", fontSize: 12.5, color: "var(--text-muted)" }}>
          Also certified: <span style={{ color: "var(--text-secondary)" }}>Clio Legal AI Fundamentals</span>
        </p>
      </div>
    </section>
  )
}
