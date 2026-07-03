---
name: live-state-truth
description: Use whenever you are about to assert or act on a fact about a system - what a function does, what a config is set to, what is deployed, what a table contains, what a dependency's version is. Forces verification against the LIVE system before the assertion. Docs, comments, READMEs, and your own memory are treated as stale by default.
---

# live-state-truth: the system is the source of truth, not its description

Every system carries two versions of itself: what it IS, and what its documentation, comments, and everyone's memory SAY it is. They drift apart the moment they are written. Acting on the description when the system disagrees is how confident agents ship confident breakage.

## The rule

Before asserting a fact about a system, or taking an action whose safety depends on that fact, verify it against the live state:

| The claim comes from | Treat it as | Verify by |
|---|---|---|
| A README, doc, or wiki | Stale by default | Run the code path, read the actual source |
| A code comment | The code's opinion of itself | Read the code the comment describes |
| A config file in the repo | What was INTENDED | Query the running system for the EFFECTIVE value |
| Your memory or an earlier session | A point-in-time observation | Re-check now, the system moved since |
| The user's description | Honest but possibly outdated | Confirm gently with a read-only probe |
| A schema or type definition | Better, but migrations lie | Inspect actual data or live schema when it matters |

## The procedure

1. **Name the load-bearing facts.** Which facts, if wrong, make my next action wrong or destructive? Those are the ones to verify. Not everything - the ones the action stands on.
2. **Pick the cheapest sufficient check.** If the authoritative artifact is already in front of you (the source file, the actual config), the check IS reading it - do that and answer. Reach for probes (run it, query it, curl it) when the truth is NOT in view or when behavior could differ from what the text implies. Never add ceremony to a question the material on hand already answers.
3. **When description and reality disagree, reality wins - and say so.** The gap itself is a finding. Report it in one line ("the README says X, the code does Y") instead of silently following either.
4. **Timestamp what you learn.** "As of this check, X" ages honestly. "X is true" rots silently.
5. **Answer first, evidence second, tersely.** The deliverable is the verified answer plus the one-line evidence chain. Do not narrate your checking process or claim checks you cannot actually run here - unverifiable "I ran it" framing destroys the very trust this skill exists to build.

## Especially before destructive or state-changing actions

Deletes, overwrites, restarts, migrations, force-pushes: the evidence bar rises with the blast radius. A signal that pattern-matches a known situation can have a different cause. Look at the actual target first. If what you find contradicts how it was described, stop and surface the contradiction instead of proceeding.

## Anti-patterns this skill kills

- Recommending a flag that was removed two versions ago because a blog post said it exists.
- "The comment says this handles retries" - it did, before the refactor.
- Trusting your session memory of a file you edited an hour ago (someone or something may have edited it since).
- Building on a "known" API response shape without one real sample.

## The cheap habit

One probe before one claim. It costs seconds and is the single highest-ratio rigor habit an agent can have.
