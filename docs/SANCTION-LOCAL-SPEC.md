# Sanction Local — Product Spec Sheet

> Internal spec, not published (not in `lib/docs.ts`). The one-page reference for the
> regulated-SMB local-AI offering. Pairs with `SPINE.md`. Last updated 2026-07-01.

## The principle (tape it to the monitor)

**Infra / runtime / governance mechanics = standard, ships as-is. Client data / domain /
regulator = custom.** Hold that line and ~80% of every engagement is configuration; blur
it and every client is a from-scratch build with a solo bottleneck. **AIIA is most of your
80%** — the offering is *"AIIA, hardened and configured for a regulated SMB,"* not a build.

## The three lines (drawn)

1. **Apple-only.** Two SKUs, decline the outliers. NVIDIA is a different *business* (rack,
   cooling, drivers, remote hands) that breaks solo-viability. The ICP's workload is bursty
   and low-concurrency, so Apple fits the work, not just the support budget.
2. **Clean-break extraction.** Extract the best code into a fresh, minimal core and maintain
   **only that.** Abandon the monorepo — which drops the quarantined-sensitive git history
   *and* the abandoned-tenant CVE surface in one move. One codebase going forward.
3. **Governance v1 = four things, nothing more.** Don't turn the SMB box into Sanction's
   spend engine (different buyer). Over-build exactly one piece: the audit log.

## Hardware — two SKUs, no more

- **SKU A — Mac Mini.** M4 32GB (value floor) / **M4 Pro 48–64GB (sweet spot)**. 3–15 person shop.
- **SKU B — Mac Studio.** M4 Max 128GB / Ultra 192GB+. Heavier corpora, light concurrency.

Unified memory, silent, under-a-desk, no CUDA. **Runtime: Ollama** default (MLX for a 10–30%
speed bump on supported models). **vLLM** is an escape hatch for a rare high-concurrency
client, never a second standard.

## Models (validate exact tags — fast-moving; default to Apache 2.0 / MIT)

v1 optimizes **RAG + instruction-following + clean license**, *not* top tool-calling — the
box retrieves and drafts, it doesn't act yet.

| Job | SKU A (Mini) | SKU B (Studio) | License |
|---|---|---|---|
| Fast (intake, extract, classify) | Qwen3 8B | Qwen3 8–14B | Apache 2.0 |
| **Workhorse / RAG (v1 default)** | **Qwen3 32B** (M4 Pro) · Qwen3 14B / Mistral Small ~24B (base Mini) | **Qwen3 32B** + headroom | Apache 2.0 |
| Heavy / reasoning | — (push to SKU B) | Llama 3.3 70B *(license caveat)* or large Qwen3/MoE | mixed |
| Agentic (later, when it acts) | — | GLM 4.6 (top open BFCL tool-caller, late-June 2026) | MIT |
| Embeddings (local) | nomic-embed-text / bge-m3 | same | Apache/MIT |

**If you ship one model, it's Qwen3 32B (Apache 2.0).** Prefer Apache/MIT so you never
explain a model license to a client's compliance reviewer (Llama/Gemma carry usage +
attribution terms — usable, but added burden). *Exact point-versions move monthly; you run
Local Loop, so validate against current model cards before they go in the sheet.*

## Governance v1 — the reason-to-believe

1. **Immutable audit log** — signed, append-only, tamper-evident. **The one exception to
   "minimal."** It's the assessor artifact, the BAA deliverable, and the thing the
   $750–1,500/mo retainer sells. Over-build this.
2. **Access control** — per-user auth + a role. Thin.
3. **Hard egress block** — *architecturally true* because the cloud-calling code isn't in the
   artifact (below), plus a network-level firewall as belt-and-suspenders. This is the
   provable "data never leaves."
4. **HITL toggle** — thin in v1 (human already reviews drafts); grows teeth when the box acts.

## Fork manifest (grounded in the xcai-aiia tree; validate file-by-file on extraction)

> **Scoping finding (verified by import trace):** the KEEP core is *entangled*. The
> `eq_brain` orchestration (`brain.py`, `__init__.py`, `memory_sync`, `session_indexer`)
> imports `supermemory_bridge`, `a2a`, `google_tts`, `voice_handler`, `slack_client` —
> so a wholesale copy drags the cloud seams back in. The extraction is therefore
> **harvest the clean primitives + re-implement a minimal orchestrator**, not a copy.
> Good news: the load-bearing IP (local RAG + local inference) is already cloud-free.

**KEEP → harvest the clean primitives (verified cloud-free, copy near-as-is)**
- `local_brain/eq_brain/knowledge_store.py` — ChromaDB + local MiniLM embeddings; docstring
  "all data stays local." The RAG core.
- `local_brain/ollama_client.py` — local inference + embeddings.
- `local_brain/inference_router.py` — local routing.
- `xcai_intelligence/frontend/` — the AIIA interface (verify its build stack on extraction).

**RE-IMPLEMENT minimally (do NOT copy — carries cloud/multi-tenant coupling)**
- The `eq_brain` orchestration → a small v1 orchestrator that wires `knowledge_store` +
  `ollama_client` into **ingest → retrieve → draft**. Small, because v1 doesn't do agentic
  loops (Line 3 / HITL-is-later).
- `services/llm_service.py` → strip to **LOCAL / Ollama only**; delete the Anthropic/Google
  provider paths; default fail-closed.
- A **minimal** local `api/` (query, ingest/upload, memory) — a handful of routes, not the 18.

### STRIP forever → abandon (don't maintain)
- **All 19 `products/`** (cathcap, aplora-*, codeword, family-law, dreamscapes, …) and their frontends.
- **Mobile:** `iosApp/`, `androidApp/`, `gradle*`, Kotlin build.
- **Multi-tenant machinery:** `config/tenants.yaml`, `local_brain/cross_tenant_worker.py`,
  tenant `agents/` (mia, ping), tenant `api/routes` (acping, aplora_legal, financial, subaru,
  x_selector, tts, integrations, visuals, graph_review).
- **All cloud egress:** Supermemory, Perplexity, cloud LLM providers, `google_tts`,
  `slack_client`, `voice_handler`, Resend, Intuit/Clio, `integrations/`, `a2a/`.
- Cathcap quant layers (`turboquant_layer`, `polar_quant_wrapper`).
- **The git history** — start a fresh repo. Drops the quarantined sensitive material and the
  CVE-laden lockfiles from abandoned deps.

### HARDEN → client-grade
- The four governance pieces above.
- Disk encryption (FileVault), network isolation, a patch cadence, a minimal dependency set,
  a written security baseline.
- Scope-of-use / "tool, not advice" language + hard liability caps in the MSA. **Legal review
  before the first client signs.**

## The 20% — custom per client (where the fee is earned)
Their corpus + formats · their workflow (*configured*, not coded) · their regulator (which
audit + retention rules bind) · their vocabulary (semantic mapping) · staff training. All
five touch data, domain, or regulator. Clean line.

## Open items
1. Validate exact model tags against current model cards.
2. Build the extraction pipeline: KEEP set → fresh repo → reproducible client artifact.
3. Legal: UPL/liability review + MSA caps before the first install.
