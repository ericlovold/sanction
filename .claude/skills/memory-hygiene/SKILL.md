---
name: memory-hygiene
description: Use when writing to or reading from any persistent memory an agent keeps across sessions - CLAUDE.md, memory files, notes, project docs meant for future sessions. Governs WHAT deserves persisting, HOW to write it so it survives time, and the recall rule: verify remembered facts against live state before acting on them. Use it also when a session starts by loading old memory.
---

# memory-hygiene: memory is a claim about the past, not a fact about the present

An agent's persistent memory is its highest-leverage asset and its most dangerous one. Good memory compounds: every session starts smarter. Bad memory compounds too: one stale "fact" confidently recalled can outvote the live system in front of you. This skill governs both directions - what goes in, and how what comes out gets trusted.

## Writing: what deserves persistence

Persist the things a future session cannot rederive:

- **Decisions and their WHY.** "We chose X over Y because Z" - the why is the part that evaporates.
- **Corrections received.** When a human corrects you, that is the single most valuable thing to persist - with the reason, so the future session applies the principle, not just the rule.
- **Non-obvious constraints.** The gotcha that cost an hour. The API that lies. The step that must come first.
- **Preferences of the humans you work with.** How they like to be asked, what they care about.

Do NOT persist what the codebase, git history, or docs already record - memory that duplicates a derivable fact is bloat that ages into contradiction. And never persist secrets.

## Writing: how

- **One fact per entry, dated.** "As of 2026-07-02, the deploy hook is armed" ages honestly. Undated facts rot invisibly.
- **Write the trigger with the fact.** A future session needs to know WHEN this matters: "when touching the publish pipeline, remember X".
- **Small and curated beats large and complete.** Memory is loaded into a finite context. Every stale line taxes every future session. Prune when you add.

## Recall: the verification rule

Remembered facts are point-in-time observations. Before ACTING on one:

1. **Grade the staleness risk.** Preferences and decisions age slowly. System state (versions, configs, file locations, what is deployed) ages fast.
2. **Fast-aging fact + consequential action = verify first.** One live probe (does the file still exist, is the flag still set, does the endpoint still respond) before building on the memory.
3. **When memory and live state disagree, live state wins** - and update the memory in the same breath. A contradicted memory left standing will bite the next session too.
4. **Say which you are using.** "Per memory from June" versus "verified just now" - the reader deserves to know the vintage of your facts.

## The maintenance habit

When a memory proves wrong: fix it immediately, do not just route around it. When a memory proves right and important: consider promoting it (clearer trigger, better placement). A memory store nobody prunes becomes a liability with a good reputation.

## The honest limit

This skill gives memory DISCIPLINE inside the tools you already have. What it cannot give is persistence itself - a skill file cannot remember your decisions for you, and everything a session learns still evaporates when the session ends unless something durable catches it. Discipline plus durable storage is the complete system. This skill is the discipline half.
