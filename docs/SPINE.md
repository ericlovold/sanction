# Sanction — The Spine (Converged Strategy)

> **Internal strategy doc. NOT published** — not registered in `lib/docs.ts`, so it
> is unreachable on the public site (same as STRATEGY/POSITIONING/ROADMAP/NEXT-TIER).
> Single source of truth for the converged go-to-market. Last updated 2026-06-30.

## The spine, stated plainly

> **Governed, local-first AI for small regulated businesses in the Upper Midwest —
> installed and run by us, with Sanction as the audit/governance layer that makes it
> compliant and recurring. Consulting audits open the door; productized verticals
> (legal first) emerge from repetition.**

Three roles, one object:
- **Sanction MCP = the vehicle / voice.** Free, open, 5-second add. How we get a channel and a flag in the agentic-governance conversation and reach the people near the compliance moment. Not the thing we monetize head-on.
- **The air-gapped local install = the revenue.**
- **The BAA = the gate between them.** For PHI, a clinic can use a cloud AI tool only if the vendor signs a business-associate agreement, and the consumer tools won't. Local AI removes the question entirely: no vendor to vet, no BAA to negotiate, nothing leaving the building. Compliance is the one line item nobody argues down.

---

## 1. The architecture is already built (grounded in code, not hypothesis)

Verified by reading `ericlovold/xcai-aiia` and `ericlovold/sanction`:

- **XCAi-AIIA is a substrate, definitively.** `xcai_intelligence/config/tenants.yaml` is the "one engine, many skins" registry — a tenant = `{corpus + policy + features + subagent route}` in a YAML block. **Ten tenants** already exist; three are legal-domain (a financial-analysis tenant, a paralegal tenant, a family-law tenant), and behavioral-health-adjacent skins exist too (a crisis-intervention/988 tenant, an ethics tenant). *Legal-first is config + corpus work, not a new build.*  (*Cathcap is currently halted — no Render deploy; the "Production" tag in tenants.yaml is stale.*)
- **AIIA is the air-gapped local harness.** `local_brain/eq_brain/knowledge_store.py` is a **ChromaDB vector store with built-in MiniLM/ONNX embeddings** — its own docstring: *"no cloud dependency. All data stays on the Mac Mini."* `ollama_client.py` does local `embed()`/`embed_batch()` (nomic-embed) + local generation (gemma). Local retrieval **and** embeddings already run on-box.
- **Sanction is the governance/audit layer** — control plane (not custody), AES-256-GCM + KMS envelope encryption, per-tenant RLS, clearance levels, and a planned signed append-only audit export (SEC-7). These are compliance primitives, already shipped or scoped.

**One engine, many skins, a local harness, and a governance gate — the pieces exist.** What was missing was the brand, the voice, and the wedge.

---

## 2. ICP — regulated SMB, with a hard size cap

The buyer is the **owner**, not a procurement committee:
- 3-physician clinic · 6–10 attorney firm · ~40-person specialty manufacturer · independent dental/optometry · small CPA firm.
- **Upper Midwest / Twin Cities metro**, in-person — meeting the owner crushes the procurement problem.
- **Hard cap in the ICP.** The moment you drift up to a 200-person hospital system or an AmLaw firm, the handshake-close model dies. Put the size cap in writing and hold it.

### The regulatory reality (accurate framing, do NOT overstate)
Cloud AI is not *prohibited* for regulated practices; it's *burdened*. Sell the burden and the risk, never a ban. (The ban claim is false, and the first lawyer you pitch will correct it.)
- **ABA Formal Opinion 512 (2024):** a lawyer using a public or self-learning GenAI tool owes duties of competence and confidentiality and usually needs *informed client consent* before inputting client info. Usable with diligence, not banned.
- **HIPAA:** a clinic can use cloud AI on PHI only with a signed BAA from the vendor; consumer tools won't sign one.
- **The local pitch:** on-prem removes the third party, so the confidentiality question is closed, not managed. No consent-and-diligence burden, no BAA to negotiate, no disclosure risk. Honest, defensible, and stronger than the false "you legally can't."

---

## 3. Offers & pricing

| Offer | Role | Price |
|---|---|---|
| **Audit / activation sprint** | **Door-opener only** — never a standalone business | $2.5K diagnostic / $5–6K sprint |
| **Local-governed install** (the spine; done-for-you is its *delivery format*, name the package) | The revenue | $12–25K fixed |
| **Managed-compliance retainer** | Recurring | $1.5–4K/mo |

- The audit opens the door and **converts to the install**. It is the least defensible thing we sell — every AI consultant offers it — so it is bait, not the business.
- The retainer floor is anchored to **compliance continuity**, not config updates: *"we keep your local stack current and compliant as models and rules change, and every quarter you get a signed, assessor-ready report of everything your agents did — ready before they ask."* New model configs / workflows are *expansion* on top. Anchor to the thing they're afraid to lose.

---

## 4. The air-gap task list (xcai-aiia) — what's done, what's left

**Already local ✅ (do not rebuild):** ChromaDB vector store + MiniLM/nomic embeddings + Ollama inference. Supermemory is *optional and already guarded* (`if self._supermemory and self._supermemory.available:` in `brain.py`) — turn it off by not configuring the key; local Chroma is the base layer.

**The egress kill-list (the actual work):**

| Egress | Air-gap action |
|---|---|
| Anthropic / Google LLM | Force `LLMProvider.LOCAL`; **disable the fallback chain → fail *closed*** (deny, don't phone Claude on a local error) |
| Supermemory | Leave unconfigured → `.available=false`. Config, not code. |
| ChromaDB + MiniLM/nomic | Nothing — already local |
| Perplexity (web search) | Disable under air-gap flag |
| CourtListener (legal corpus) | **Pre-ingest** the case-law corpus into Chroma; no live fetch |
| Clio (legal practice mgmt, client data) | LAN/on-prem connector or disable — never cloud |
| Google TTS / Resend / Slack / QuickBooks | Disable under air-gap flag (none in the legal skin's core path) |

**The tie-together:** an **"air-gapped mode" config profile** — forces local inference + fail-closed, unsets cloud keys, disables external connectors. Then **Sanction enforces a no-egress policy at runtime and audits that nothing left the box.** That deny-list + the signed proof *is* the BAA artifact. The enforcement isn't extra work on top of the product — it **is** the product.

**Estimate:** local inference → days. Memory/RAG → ~done. Egress kill-list + air-gap flag → ~1–2 weeks for a clean legal-skin install. Sanction no-egress policy + audit export → existing product, repointed. **Weeks, not months.**

---

## 5. Brand architecture — consolidated on Sanction

- **XCAi-AIIA** — the platform/substrate (internal plumbing, not customer-facing).
- **AIIA** — the air-gapped local harness/runtime (internal).
- **Sanction** — the brand. The governance/audit layer, the voice/vehicle, **and** the
  regulated-SMB offering itself, shipped as **Sanction Local**.

**Aplora is retired.** The earlier "the legal product needs its own name" tension is
resolved by consolidating on Sanction: one brand carries the dev-facing governance tool,
the voice/channel, and the local install. A vertical (legal, clinic, etc.) is a
configuration + corpus of Sanction Local — not a separate brand.

---

## 6. Distribution — a channel and a Rolodex, not a generic community

The community we grow and the buyer who needs a BAA can be **disjoint populations**. Generic AI-Twitter devs ≠ the 4-doctor clinic. So:

- **Plant the flag on the opinion, not on "easy."** "5-second add" is table stakes (MintMCP markets minutes-to-deploy). The flag is **self-hostable + assessor-ready audit + small-regulated-org-friendly.**
- **Partner channel, not organic OSS community.** MSPs, fractional CTOs, healthcare-IT contractors who sit between clinics/firms and their software — they don't "community," they adopt through partner programs. Motion: *"deploy compliant agentic AI for your regulated clients; we white-label the governance layer; you keep the relationship + a margin."*
- **The highest-leverage node: the auditor / insurer.** HIPAA consultants, SOC 2 auditors, cyber-insurance underwriters *create* the BAA moment and refer reflexively — they ARE the compliance pressure. Get on three regional HIPAA consultants' checklists = demand generated at the exact moment of mandatory need.
- **Open-core line (draw it explicitly):** *free* — connector, the 5-second add, basic policy (adoption). *Paid* — audit export, BAA posture, multi-tenant management, the assessor report (monetization). Open for reach, closed for compliance, so the channel can't cannibalize the spine.
- **Discipline:** the community/connector is a **byproduct of the consulting spine** (open-source the governance component you build for paid installs), not a parallel startup that competes for solo attention.

---

## 7. The Perplexity report — cherry-pick

The report (a 4-co-equal-service-line plan from *before* the anchor) was four businesses looking for a spine. Verdict:

- **KEEP:** the regulatory rules (ABA 1.6, NY Bar, HIPAA); the GTM tactics (paid diagnostic, 50% upfront + Stripe + one-page SOW, single-member LLC + IP assignment, "lead with compliance not technology," in-person owner-buyer); the package-naming discipline ("DocBot *for Law Firms*"); pricing comps that align with §3.
- **KILL:** the four co-equal service lines (the diffusion trap); the "AI Second Opinion" async retainer (undifferentiated — a $20/mo ChatGPT does most of it); token-spend-as-wedge (prices are collapsing); "Sanction = horizontal MCP gateway vs MuleSoft/Kong" (wrong positioning).
- **REFRAME:** audit = door-opener only; done-for-you = the install's delivery format; recurring = compliance maintenance, not async Q&A.

### ⚠️ Unverified — quarantine until a primary source confirms
These come from a Perplexity report and **Perplexity fabricates citations**. Do **not** put them in a deck or on the site until independently verified:
- on-prem LLM market "$3.81B / 23.8% CAGR"; "local ≈18× cheaper/M tokens"; "68% of SMBs cite privacy #1."
- Case studies: "12-person clinic, Mistral 7B, intake 15→4 min, $47 vs $890"; "8-attorney firm, Llama 3, research −40%."
Citing a hallucinated case study to a regulated buyer is the one mistake that detonates trust. (The ABA/NY-Bar rules ARE real and checkable.)

---

## 8. First 90 days

1. Land **3 audits** in the backyard (Hugo / Twin Cities — owner-buyers met in person).
2. Convert **at least one** to a full local-governed install.
3. Let that single install **define the productized package** (the legal skin first — the substrate skin exists).
4. Stand up the **managed-compliance retainer** on what you installed.
5. In parallel: ship the **air-gapped mode** + Sanction no-egress audit so install #1 can truthfully make the "data never leaves" claim.

---

## 9. Locked vs. open

**Locked:**
- Regulated-SMB local-first AI is the spine (not co-equal with generic "AI activation").
- One product with skins (substrate confirmed), legal first.
- AIIA air-gap is ~80% built; the missing piece (provable no-egress) is literally Sanction.
- Sanction = governance gate + voice/vehicle + the offering brand (**Sanction Local**). Aplora retired; one brand.

**Open decisions:**
1. **On-prem sequencing fork (the real money/liability call):** does install #1 ship Sanction *hosted* (you eat a BAA + the "data never leaves" contradiction), or do you build air-gapped mode *first* (slower to first dollar, the pitch is true, and you may dodge Business-Associate status entirely)? Recommendation: build air-gap mode first — being a solo HIPAA Business Associate is the heaviest liability in the plan, and the air-gap dodges it.
2. **Verify the Perplexity stats** (§7) before any external use.
3. **Legal-skin liability review:** UPL exposure, bar AI rules, privilege, malpractice-adjacent risk if a tool's output is relied on. Positioning must be "a tool the firm uses under its own supervision," with hard liability caps in the MSA. *Get a lawyer before the first firm signs.*

**Risks:** solo capacity ceiling (~20 billable hrs/wk → productize + templatize early); SaaS-vs-services optics for a future raise (track every consulting client as a product-conversion datapoint); on-prem support complexity (standardize on 2–3 hardware + 2–3 model configs); competitive response at the MCP layer (stay in the SMB tier where procurement doesn't exist — the $392M of funded agentic-security money is all enterprise).

---

## Provenance (so the next session can trust this)
- **Grounded in code** (read directly): the XCAi-AIIA substrate/tenants, the local ChromaDB+Ollama RAG stack, Supermemory being optional, Sanction's compliance primitives.
- **Strategic synthesis:** the spine, ICP, offers, distribution, brand architecture.
- **Unverified third-party:** everything in the §7 quarantine box.
