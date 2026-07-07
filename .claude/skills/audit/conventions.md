# Audit conventions — severity, scoring, report template

Shared by every topic in `topics/`. Read this once per audit run; every report
must follow it exactly so scores are comparable across topics and across runs.

## Ground rules

- **Read-only.** An audit never modifies the codebase, config, git state, or
  running systems. The only writes allowed are new files under `audit/`.
- **Evidence or it didn't happen.** Every finding cites `file:line`, a command
  plus its output, or a config key. Every *absence* claim ("no tests exist")
  states what was searched and how (globs, greps, dirs listed).
- **Judge what's there, not what's fashionable.** A small project doesn't need
  Kubernetes. Score against what THIS project needs given its size, users, and
  blast radius — the rubric below is calibrated for that.
- **Current state only.** Git history may be cited as evidence of practice
  (e.g. direct-to-main commits), but the score reflects the repo as it stands.

## Severity scale (per finding)

| Severity | Meaning |
|---|---|
| **Critical** | Exploitable or data-losing today; or blocks the project from running at all |
| **High** | Will cause an incident under normal use — first attacker, first traffic spike, first bad deploy |
| **Medium** | Costs real time or risk, but survivable; degrades trust in the system |
| **Low** | Friction, smell, or missed convention; fix opportunistically |
| **Info** | Observation worth recording; no action required |

## Maturity score (per topic, 0–5)

| Score | Meaning |
|---|---|
| **0** | Absent. The practice does not exist here in any form |
| **1** | Trace. Someone started (a stub, an empty config, one test) but it does nothing |
| **2** | Ad-hoc. Present but inconsistent, unenforced, or trivially bypassed |
| **3** | Functional. Works for the happy path; gaps at edges; not enforced by automation |
| **4** | Solid. Consistent, automated where it matters, gaps are known and deliberate |
| **5** | Exemplary. Enforced, monitored, documented; would pass review at a strong engineering org |

Interpretation across a whole scorecard: mostly 0–1 → amateur/AI-built and not
production-viable without significant remediation; mostly 2–3 → a working
prototype that has never met real users, load, or an attacker; mostly 4–5 →
professionally maintained; the audit is a punch list, not a rescue.

## Amateur / AI-built signal (per topic)

Separate from maturity: how strongly does the evidence in this topic suggest
the code was produced by a beginner or an unsupervised AI assistant?

| Rating | Meaning |
|---|---|
| **None** | Nothing here suggests it |
| **Weak** | One or two mild tells, explainable by haste |
| **Moderate** | A recognizable pattern of tells |
| **Strong** | Unmistakable — the tells dominate the topic |

Classic tells (topic files list their own): boilerplate comments narrating the
obvious, duplicated near-identical blocks instead of abstraction, hallucinated
or unused dependencies, README claims that don't match the code, secrets
committed then "removed" in a later commit, five styles of error handling in
one module, test files that assert nothing.

## Report template

Each topic writes exactly one file: `audit/<topic-slug>.md` (slug = the topic
filename minus its `NN-` prefix). Structure:

```markdown
# <Topic name> — audit findings

- **Maturity score:** N/5 — <one-line justification>
- **Amateur/AI-built signal:** None|Weak|Moderate|Strong — <one-line justification>
- **Audited:** <date> · **Scope:** <dirs/files examined, commands run>

## Summary

Three to six sentences: the state of this practice in this repo, the biggest
risk, and what "fixed" looks like.

## Findings

| # | Severity | Finding | Evidence |
|---|----------|---------|----------|
| 1 | High | <one sentence> | `path/file.ts:123` |

## Detail

### 1. <Finding title>
What was found, why it matters here, the evidence in full (quoted lines,
command output), and the concrete fix.

## What was checked and found sound

Bullet list — practices examined that are fine. This section is mandatory:
it distinguishes "looked and it's good" from "didn't look."

## Recommendations (ranked)

1. <Highest-leverage fix first, with effort estimate: hours / days / weeks>
```

## Scorecard

A full-suite run ends by writing `audit/SCORECARD.md`: a table of every topic
with its maturity score, signal rating, and finding counts by severity, plus a
short overall verdict using the interpretation bands above.
