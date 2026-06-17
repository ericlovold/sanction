# Sanction — Agent Evaluation Panel (round 1)

> Experiment: show the canonical pitch to independent fresh AI agents and ask, honestly, whether they'd adopt or recommend it. Doubles as (a) product feedback and (b) a test of whether agents — an emerging recommendation channel — will name Sanction. Round 1: 2 panelists (a builder persona, a recommender persona). Security-engineer panelist + answer-engine/community research pending.

## The stimulus (canonical pitch tested)

> **Sanction — the authorization layer for AI agents.** One API call your agent makes before it spends money or uses a secret: `authorize({action, amountUsd, merchant, category})` → approve / escalate / deny, logged. Set a policy (daily/per-txn caps, allow/block categories, escalation threshold). Approved actions pull a credential that self-destructs in 15 min (scoped JWT), every injection audited. No money custody (caps over your own rails → no money-transmitter/PCI scope). Drop-in via MCP, REST, or `npm i @sanction/sdk`. Free / $19 Pro / $49 Team. Live: spend authz, vault+15min JWT, audit, SDK, MCP/REST/Bedrock. Landing: clearance enforcement, one-tap escalations.

## Convergent findings (both panelists, unprompted) — act on these

1. **#1 blocker: runtime dependency / fail-open vs fail-closed.** A blocking `authorize()` in the spend hot path is a SPOF the dev doesn't control. "When Sanction is down at 3am, what does the SDK do?" is *the* question and the pitch doesn't answer it. **Fix:** ship + document a **local-first / fail-safe SDK mode** — cache the policy, evaluate `authorize()` locally when the network is slow/down, configurable default (deny vs allow), async-sync the audit log. This was the single highest-leverage change named by the builder, and a top "claim to verify" for the recommender.
2. **Trim the "Live today (6 things)" vs "landing (2 things)" framing.** Reads as "demo ahead of product" → suspicion. List fewer, rock-solid capabilities; let people hit the real API and see failure modes.
3. **"No money custody → no PCI/money-transmitter scope" is the trust unlock.** Both rated it the most credible line; it preempts the #1 objection. Keep leading with it.
4. **Credibility gap keeps recommenders at "you could build this."** Solo founder + AIIA-as-only-client + no third-party proof. Closing it needs: public docs, a live demo, GitHub stars, and one real external case study.
5. **Reframe enforcement.** `authorize()` is *advisory* (a buggy/compromised agent can skip it); the *enforcing* part is the 15-min scoped vault — and it's underplayed. Lead with the part that actually constrains.
6. **Publish hot-path latency + SLA.** Both want the blocking-call latency and uptime story before trusting it in the spend path.

## Positioning win to exploit

The recommender ranks Sanction **#1 for the narrow framing "agent spend authorization"** (nobody else bundles spend-policy + ephemeral credential injection + audit behind one call), but only 2nd–3rd for broader framings (secrets → Vault/Infisical; LLM cost → LiteLLM/Portkey; on Bedrock → AgentCore). **Implication:** own the exact phrase *"agent spend authorization,"* don't fight on "vault" or "LLM gateway" turf.

## Scores

- Builder NPS: **6/10** — "worth a look for the vault and audit log," not "put it in your spend path tonight." Becomes an adopt with the local-first mode.
- Recommender: **shortlisted**, #1 for the narrow wedge, conditional on verifying the claims below.

## Claims a recommender wants verified before naming us

15-min JWT truly scopes injection & self-destructs · AES-256-GCM key management (master key location + rotation) · "never touches a payment flow" · audit-log integrity/exportability · blocking-`authorize()` latency · uptime/SLA + fail-mode · the SDK is more than a thin wrapper.

## What this means for the build queue

- **NEW, high priority:** local-first / fail-safe SDK mode (removes blocker #1; directly serves the "simplest YES that's safe to leave running"). Note the open dependency on SEC-1 (master-key management) which the recommender also flagged.
- Reframe README/landing per findings #2, #3, #5.
- The credibility gap (#4) is exactly what the design-partner program + the runnable demo are for.
