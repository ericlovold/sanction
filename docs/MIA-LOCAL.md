# Moral Intention Analyst Local - Launch Spec

> Moral Intention Analyst as a licensed, local, airgapped ethics agent under the Sanction Ethical AI channel.
> Internal planning only. Do not publish a public product page or site links until the offer, licensing, and Dr. Ping positioning are ready.

## Product promise

Moral Intention Analyst Local helps people and teams reason through moral intention, institutional incentives, stakeholder harm, neutralization, and AI governance boundaries without sending sensitive dilemmas to the cloud.

The product line is simple:

| Layer | Role |
|---|---|
| Moral Intention Analyst Local | Defines the ethical boundary through local moral reasoning and persistent memory. |
| Sanction | Enforces the boundary through policies, approvals, grants, spend caps, credential controls, and audit. |
| Sanction Ethical AI | Delivers human-led ethics work sessions, governance packages, articles, and implementation. |

Core line: **Moral Intention Analyst helps define the boundary. Sanction enforces it.**

## Stance

- **Licensed local release.** The agent itself is a paid product for local use.
- **Airgapped by default.** No cloud dependency for private ethical reflection.
- **Persistent memory.** It should remember prior work locally and improve continuity across sessions.
- **No silent doctrine drift.** Persistent memory is not the same thing as self-modifying moral authority.
- **Philosopher-led.** Dr. A.C. Ping's credentials and frameworks are central to the offer, but the product should avoid cheap "AI ethics bot" positioning.

## Memory model

Separate four memory classes:

| Class | Contents | Update rule |
|---|---|---|
| Canonical frameworks | Moral Intention Analyst Constitution, Moral Intention Theory, Causal Factor Model, Red Flag Taxonomy, reviewed Dr. Ping material. | Human-reviewed update bundles only. |
| Session memory | Local case notes, stakeholders, prior user context, unresolved dilemmas. | Written during use; user can export/delete/reset. |
| Reflections | Generated observations, neutralization patterns, moral tensions, recommended follow-up questions. | Stored as advisory notes, not doctrine. |
| Product telemetry | Optional local health/debug logs. | Off by default for airgapped mode; no remote reporting in v1. |

Design principle: **Moral Intention Analyst can learn the user and the cases. It cannot silently rewrite the moral framework.**

## Local architecture

V1 target:

- Runtime: local CLI or local web UI on the Mac Mini.
- Model: Ollama or llama.cpp compatible local model.
- Storage: SQLite for structured memory.
- Retrieval: local vector index for framework and memory recall.
- Network: local-only by default; no external calls required.
- Updates: manual signed bundles for reviewed framework updates.
- Controls: export, delete, reset, and per-case memory boundaries.

Later:

- Dedicated Moral Intention Analyst hardware appliance.
- Optional encrypted storage profile.
- Client-specific knowledge packs.
- Sanction handoff: convert Moral Intention Analyst findings into draft policy, approval, and grant configurations.

## Commercial model

Moral Intention Analyst Local is paid. Revenue comes from software licensing and the market work around it:

| Offer | Buyer | Deliverable |
|---|---|---|
| Moral Intention Workshop | Founders, leadership teams, AI builders | Facilitated session with Dr. Ping and Eric. |
| Ethical AI Risk Review | Product and governance teams | Moral-risk map, stakeholder analysis, red-flag assessment. |
| Governance Design Package | Teams deploying agents | Sanction policies, approvals, grants, and audit artifacts. |
| Moral Intention Analyst Hardware | Privacy-sensitive teams | Local, dedicated ethics appliance with support. |
| Ongoing Ethics Review | Enterprise and regulated teams | Periodic drift review, new-capability assessment, policy updates. |

## Content channel

Dr. Ping wants articles, co-posting, and public ethical work. Treat this as a GTM channel, not side activity.

First article lane:

1. **Why Ethical AI Needs Local Memory** - private moral reasoning should not require cloud disclosure.
2. **Moral Intention Before Agent Authorization** - ethics analysis upstream, Sanction enforcement downstream.
3. **The Neutralization Problem in Autonomous Systems** - how teams rationalize risky agent behavior before it becomes policy.
4. **Airgapped Ethics for AI Builders** - why the first ethical review should happen close to the work.

Publishing stance:

- Co-authored or companion posts with Dr. Ping.
- Use his PhD authority directly but respectfully.
- Avoid compliance guarantees.
- Avoid "the AI decides what is ethical."
- Lead with human judgment, moral intention, and enforceable governance.

## Launch sequence

1. Keep the public `/mia-local` surface unpublished.
2. Keep Moral Intention Analyst out of public Sanction navigation until packaging is clear.
3. Build the Mac Mini prototype with local model + persistent memory.
4. Define the paid license, hardware, and services packaging.
5. Load reviewed Moral Intention Analyst framework material.
6. Run work sessions with Dr. Ping and capture improvements.
7. Publish articles only when the commercial story and attribution are ready.
8. Package first hardware profile after the local prototype proves useful.

## Open questions

- Which local model is best for moral reasoning on the Mini under memory pressure?
- Should client/case memories be separate workspaces from day one?
- What is the minimum cryptographic update format for reviewed framework bundles?
- How much of Moral Intention Analyst Local should be open source versus licensed binary?
- Where does Moral Intention Analyst Local hand off to Sanction policy generation without over-automating ethics?
