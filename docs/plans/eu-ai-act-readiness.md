# EU AI Act readiness — the Aug 2, 2026 sprint

*Draft plan. Not legal advice — Sanction is an evidence/oversight enabler, not a
compliance guarantor. Phrasing here is deliberately careful for that reason.*

## The deadline, accurately

**Aug 2, 2026**: the AI Act becomes fully applicable. The concrete trigger is
that the Commission's **enforcement powers over general-purpose AI (GPAI)
models — including fines — enter into application**, and the governance /
penalties framework goes live.

The **high-risk** obligations most people associate with the Act were *pushed
back* by the May 2026 **Digital Omnibus** agreement:
- High-risk **Annex III** (standalone: biometrics, employment, education,
  critical infrastructure, public services…) → deferred to **Dec 2, 2027**.
- High-risk **Annex I** (embedded in regulated products) → deferred to
  **Aug 2, 2028**.
- These deferrals take legal effect only on formal adoption/publication of the
  Omnibus, **expected just before Aug 2, 2026** — so treat them as "very likely
  but not yet law" until published.
- GPAI models placed on the market before Aug 2, 2025 → comply by Aug 2, 2027.

**Read for us:** Aug 2, 2026 is the *enforcement-goes-live* moment and the point
at which every enterprise deploying AI is asking "can we evidence oversight and
logging for our AI?" — even though the hard high-risk clock now runs to late
2027. The buying urgency is real; the technical deadline is softer than the
headline. We position on the urgency without overclaiming the mandate.

## The thesis

Sanction is **not** itself a high-risk AI system (it's a governance/authorization
layer, not an AI system making consequential decisions about people). Its role is
as the **evidence and human-oversight layer** an organization puts *around* the
AI agents it runs, so that org can demonstrate the controls the Act expects:

> Every governed agent action produces a tamper-evident, replayable record of
> what was decided, under which policy revision, and — when it mattered — which
> human approved it. That is exactly the logging + oversight + traceability the
> Act asks operators to have.

We sell "you can **evidence** oversight and record-keeping for your AI agents,"
never "we make you compliant."

## Crosswalk — Act obligation → Sanction primitive → status

| Act requirement | Sanction surface | Status |
|---|---|---|
| **Art 12 — record-keeping / automatic logging** of events over the system's lifetime | AuthorizationRequest + TokenLog + CredentialInjection audit tables; `/audit-events` feed; **signed, hash-chained `/audit/export`** + `/audit/verify` | **Ready** — strongest fit |
| **Art 14 — human oversight** (a person can intervene / stop) | Escalation → `PendingApproval` → human approve/deny → one-use `Grant`; freeze (KILL-1) kill-switch | **Ready** |
| **Art 13 — transparency / interpretability** of decisions | Stable `DecisionCode`s + reasons; evidence replay (`decisionContextJson` + `policyRevision`) reproduces any decision | **Ready** |
| **Art 9 — risk management** (documented, enforced controls) | Policy engine: budgets, per-txn caps, category/tool/capability ladders, CPO ceilings, subtree caps | **Ready** (as enforced controls) |
| **Traceability / determinism** (same input + policy ⇒ same decision, evidenced) | EVID-1 policy revisions + stored contexts + replay match verdict | **Ready** |
| **Art 15 — accuracy, robustness, cybersecurity** | RLS tenant isolation (SEC-3), envelope encryption (SEC-1/KMS), fail-closed auth planes; `docs/SECURITY.md` | **Partial** — security posture documented; not framed against Art 15 |
| **Who decided, when, why** (oversight evidence quality) | Approval records approver + note + timestamp | **Verify** — confirm the approver identity + rationale is captured on every human decision |
| **Retention / immutability** of the log | Append-only tables; signed export | **Gap** — no stated retention window or immutability guarantee |
| **AI-Act-framed evidence bundle** | `/audit/export` is generic | **Gap** — no Article-mapped export manifest |

## Sprint slices (ranked, fenced)

1. **AI Act crosswalk, published** *(same-day fenced slice)* — `docs/EU-AI-ACT.md`
   + a `/docs/eu-ai-act` route + a link from `/why` or a new `/compliance`
   section. The table above, carefully worded, is the GTM artifact and the
   honest map. Ship this first; it needs no product change.
2. **Oversight-evidence audit** *(verify)* — confirm every human approval
   persists approver identity, timestamp, and rationale; if a rationale field is
   missing on any escalation path, add it. This is the load-bearing Art 14 claim.
3. **AI-Act evidence pack** *(product)* — an `/audit/export` variant (or manifest
   flag) that frames the existing signed chain against Art 12/13/14 and stamps
   retention metadata. Builds on the export we already have + the new subtree
   scope, so an org can pull one signed org-wide evidence bundle.
4. **Retention & immutability statement** *(docs + maybe enforcement)* — state
   (and, where cheap, enforce) how long the audit trail is kept and that it's
   append-only. Closes the retention gap; enterprise-legal will ask.
5. **GTM moment** *(marketing)* — a landing section: "Evidence oversight and
   logging for your AI agents — before Aug 2." Ties to the crosswalk + the
   demo's live audit export → verify moment.

## Guardrails

- No "compliant / certified / guaranteed" language anywhere. "Evidence,"
  "demonstrate," "map to," "helps you meet" only.
- Cite primary sources (the Act text + Commission guidance), not blog summaries,
  in anything public.
- Keep the high-risk timing honest: the hard clock is 2027/2028 pending the
  Omnibus; the Aug 2 urgency is enforcement-live + buyer attention.

## Open questions for Eric

- Scope for this sprint: just the crosswalk + oversight-evidence audit (slices
  1–2, low-risk, fast), or push into the evidence-pack product work (slice 3)?
- Do we want a dedicated `/compliance` surface, or fold this into `/why` + docs?
- Any customer/legal counterparty already asking for this — i.e., is there a
  specific evidence format to target?
