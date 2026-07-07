# 03 — Solutions design

Read `../conventions.md` first (severity scale, scoring, report template).

**Question:** Was this system designed, or did it accrete?

## Investigate

- Design records: ADRs, design docs, a docs/ directory with intent, or any
  written "why" for the major choices (framework, DB, auth model, hosting).
- Boundary quality: is there a discernible layering (routes / domain logic /
  persistence), or does everything import everything? Sample the imports of
  the 5 largest modules.
- Consistency of pattern: pick three similar features (e.g. three endpoints or
  three pages) and compare their shape. Same pattern, or three inventions?
- Accidental architecture: duplicated logic that should be shared, shared
  state where isolation was needed, framework fighting (working around the
  tool instead of with it).
- Fit: is the stack proportionate to the problem, or resume-driven /
  AI-default (e.g. microservices for a to-do app)?

## Amateur / AI-built signals

- Each feature built in the style of whatever the AI defaulted to that day —
  no house pattern.
- Abstractions with a single implementation and speculative interfaces.
- Zero written design intent anywhere, at any size.

## Report

Write `audit/solutions-design.md` per the conventions template. Read-only.
