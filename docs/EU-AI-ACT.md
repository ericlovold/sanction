# Sanction & the EU AI Act

**Sanction is the evidence and human-oversight layer you put around the AI agents
you operate** — so you can *demonstrate* the record-keeping, transparency, and
oversight the EU AI Act expects. It is not legal advice, and it does not make you
compliant. It gives you signed, replayable proof of how your agents were governed.

## What Aug 2, 2026 actually is

On **2 August 2026** the AI Act becomes fully applicable: the Commission's
enforcement powers over general-purpose AI (GPAI) models — including **fines** —
come into force, and the governance and penalties framework goes live.

The **high-risk** obligations most teams brace for were *pushed back* by the May
2026 **Digital Omnibus**: high-risk Annex III (standalone) systems to **2 Dec
2027**, and Annex I (embedded in regulated products) to **2 Aug 2028** — taking
legal effect on the Omnibus's formal publication, expected just before Aug 2,
2026. GPAI models placed on the market before Aug 2, 2025 have until Aug 2, 2027.

**So:** Aug 2, 2026 is the enforcement-goes-live milestone and the moment every
enterprise deploying AI starts asking "can we evidence oversight and logging for
our AI?" The hard high-risk clock now runs to 2027–2028, but the question — and
the buying urgency — is here now.

## Where Sanction fits

Sanction is not itself a high-risk AI system: it's an authorization and
governance layer, not an AI system making consequential decisions about people.
Its job is to produce the **operator evidence** that the Act's logging (Art 12),
transparency (Art 13), and human-oversight (Art 14) provisions call for, for the
agents *you* run.

## Crosswalk — obligation → Sanction surface → how to pull the evidence

| AI Act obligation | Sanction surface | Evidence you can produce today |
|---|---|---|
| **Art 12 — automatic record-keeping / logging** over the system's lifetime | Every governed decision (spend, tool, capability, provision), token log, and credential injection is persisted | `GET /api/v1/audit/export` — a **signed, hash-chained** snapshot; altering, dropping, or reordering any entry breaks the chain |
| **Art 13 — transparency & interpretability** of outputs | Stable decision codes + the exact policy revision each decision ran under; deterministic replay reproduces any decision | Each decision carries `policy_revision`; replay evidence via the evidence endpoints |
| **Art 14 — human oversight** (a person can intervene and stop) | Escalation → human approval/denial → single-use grant; the freeze kill-switch halts an agent or a whole pool instantly | Approvals record **who** decided, **when**, and **why** (`resolvedBy`, timestamp, rationale) |
| **Art 9 — risk management** (documented, enforced controls) | Budgets, per-transaction caps, category/tool/capability allow-lists, cost-per-outcome ceilings, subtree caps | The policy revision history is the documented, versioned control set |
| **Traceability / reproducibility** | Immutable policy revisions + stored decision contexts + replay match verdict | Same request + same revision + same state ⇒ same decision, provably |
| **Art 15 — accuracy, robustness, cybersecurity** | Row-level tenant isolation, envelope-encrypted credential vault, fail-closed auth planes | See [Security & threat model](SECURITY.md) |

## One signed, Article-framed evidence bundle

Pull a tamper-evident export for a wallet — or a whole org — framed against the
Act:

```bash
# The whole org (a parent wallet + every pool beneath it), framed for the Act.
curl "https://getsanction.com/api/v1/audit/export?wallet_id=WALLET_ID&scope=subtree&framing=eu-ai-act" \
  -H "x-mgmt-key: sk_your_management_key"
```

You get the normal signed export **plus** an `ai_act` block: the Article mapping,
the retention statement, decision counts (including how many were resolved by a
named human), and the signed head. Prove it wasn't altered afterward:

```bash
# Anyone can re-verify the chain + signature — no trust in us required.
curl -X POST "https://getsanction.com/api/v1/audit/verify" \
  -H "x-mgmt-key: sk_your_management_key" \
  --data-binary @export.json
# → { "valid": true, "chain_valid": true, "signature_valid": true, "count": N }
```

The `ai_act` framing rides *alongside* the signed decisions — it never alters
them, so verification is independent of the framing.

## Retention & immutability

The audit trail is **append-only**. Governed decisions, token logs, and
credential-injection records are never modified or deleted after write — there is
no purge job and no mutation path. An export is a **signed snapshot** of a time
range; the underlying records remain for the life of the wallet. This is the
record-keeping durability Art 12 is asking for.

## The honest boundary

- Sanction gives you **evidence to support** Art 12/13/14 obligations. It is not
  a compliance certification, a conformity assessment, or legal advice.
- The high-risk timeline is **2027–2028** pending the Digital Omnibus; the Aug 2,
  2026 date is enforcement-live + GPAI. We say "helps you demonstrate," never
  "makes you compliant."
- Talk to your own counsel about which obligations apply to your systems.

Primary sources: the [AI Act text and Commission guidance](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai).
