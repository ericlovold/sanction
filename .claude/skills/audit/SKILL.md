---
name: audit
description: Use when the user asks for a code audit, sanity check, maturity assessment, or "vibe-code check" of this repo (or a repo they point at) — e.g. "/audit", "/audit 14", "/audit security", "audit the whole repo", "how production-ready is this". Runs one, several, or all 29 best-practice topics as read-only investigations, each writing an evidence-backed report with a 0–5 maturity score and an amateur/AI-built signal rating to audit/<topic>.md, then rolls a full run into audit/SCORECARD.md.
---

# audit: evidence-backed best-practice sanity check

Adapted from the "AI Code Sanity Check" audit-prompt suite: a library of
single-topic investigations that catch the failure modes typical of
vibe-coded projects. Each topic reads the repo, cites evidence, scores 0–5
maturity plus an amateur/AI-built signal, and writes `audit/<slug>.md`.

**Read-only, always.** An audit modifies nothing outside `audit/`. In this
repo `audit/` is gitignored — findings enumerate weaknesses and stay local
unless deliberately shared.

`conventions.md` (in this skill directory) is the shared contract: severity
scale, scoring rubric, signal rating, report template. Every topic run reads
it first. Topic files live in `topics/NN-<slug>.md`; each writes
`audit/<slug>.md` (slug = filename minus the `NN-` prefix).

## Run modes

**Single topic** — `/audit 14` or `/audit security`: resolve the argument
against the index below (number, slug, or close keyword), read
`conventions.md` + the topic file, run the investigation yourself, write the
report, and give the user the score + top findings inline.

**Subset** — `/audit 14 23 24` or `/audit "security, scalability"`: as above,
one topic at a time or via parallel subagents if 3+ topics.

**Full suite** — `/audit` with no argument, or "audit everything": 29 heavy
investigations will not fit one context. Orchestrate, don't do:

1. Confirm scope with the user if the target repo is ambiguous (default: the
   current working directory's repo).
2. Dispatch one **Explore or general-purpose subagent per topic** (read-only
   task; batch in parallel). Each subagent prompt: "Follow
   `.claude/skills/audit/topics/NN-<slug>.md` against <repo root>. Read
   `.claude/skills/audit/conventions.md` first. Write your report to
   `audit/<slug>.md`. Modify nothing else."
3. **The filesystem is the ledger.** A topic counts as done only when
   `audit/<slug>.md` exists and contains a `**Maturity score:**` line. After
   the batch, list `audit/` and verify all 29. Re-dispatch any gap — never
   assume, never let a long run silently skip topics. Re-runs skip topics
   whose valid report already exists (resumable by construction).
4. When all 29 reports exist, write `audit/SCORECARD.md`: table of topic /
   score / signal / findings-by-severity, then an overall verdict per the
   interpretation bands in `conventions.md`.
5. Report to the user: the verdict, the 5 worst findings across all topics,
   and any topic that ended N/A.

## Topic index

| # | Topic file | Catches |
|---|---|---|
| 01 | `topics/01-source-control.md` | Committed secrets, junk history, no remote |
| 02 | `topics/02-documentation.md` | README that lies, no setup/run docs |
| 03 | `topics/03-solutions-design.md` | No design intent, accidental architecture |
| 04 | `topics/04-task-tracking.md` | No tracker, no traceability, TODO graveyard |
| 05 | `topics/05-environment-management.md` | Works-on-my-machine, no reproducible setup |
| 06 | `topics/06-dependency-management.md` | No lockfile; hallucinated/vulnerable deps |
| 07 | `topics/07-linting.md` | No enforcement, suppression abuse, dead code |
| 08 | `topics/08-code-review.md` | Direct-to-main, no review gate |
| 09 | `topics/09-remote-code-review.md` | No automated review/scanning in CI |
| 10 | `topics/10-cicd.md` | No pipeline, gates that can't fail, manual deploys |
| 11 | `topics/11-unit-testing.md` | No tests, assertion-free tests |
| 12 | `topics/12-integration-testing.md` | Nothing tests the seams |
| 13 | `topics/13-error-handling.md` | Swallowed errors, no timeouts, leaky 500s |
| 14 | `topics/14-application-security.md` | OWASP Top 10, authz gaps, secrets |
| 15 | `topics/15-logging.md` | print-debugging, logged secrets, no structure |
| 16 | `topics/16-observability.md` | No metrics/health/tracing; blind in prod |
| 17 | `topics/17-alerting.md` | Failures are silent; users are the pager |
| 18 | `topics/18-database-management.md` | No migrations/backups/pooling; float money |
| 19 | `topics/19-api-design.md` | No contract/versioning; inconsistent errors |
| 20 | `topics/20-infrastructure-as-code.md` | Click-ops infra, dashboard-only config |
| 21 | `topics/21-versioning.md` | No releases/changelog; silent breaking changes |
| 22 | `topics/22-accessibility.md` | Div-soup UI, keyboard traps (WCAG); N/A if no UI |
| 23 | `topics/23-scalability.md` | N+1, no caching, in-process state |
| 24 | `topics/24-high-availability.md` | SPOFs, no timeouts, untested recovery |
| 25 | `topics/25-cost-operational-readiness.md` | Runaway spend, bus factor of one |
| 26 | `topics/26-iaas-platforms.md` | Open IAM/network/storage; N/A if no raw cloud |
| 27 | `topics/27-application-delivery-platforms.md` | PaaS physics violations; N/A if no PaaS |
| 28 | `topics/28-llm-integration.md` | Client-side keys, injection, uncapped spend; N/A if no LLM |
| 29 | `topics/29-data-privacy.md` | PII with no retention/deletion/disclosure |

## Rules

- Never modify anything outside `audit/`. Check mode for linters/tests, no
  fixes, no installs, no deploys, no history rewrites.
- Every claim cites evidence; every absence claim states what was searched
  (conventions.md governs).
- Scores come from the rubric, not vibes — a plausible-sounding 3 needs the
  same evidence as a 0.
- Overlapping topics (e.g. N+1 in both 18 and 23) are noted where secondary
  and scored where primary — don't double-count findings in the scorecard.
- When auditing *this* repo, AGENTS.md context applies (e.g. coverage ratchet,
  RLS design, migration guards) — judge against what the repo declares, then
  verify the declaration against live state.
