# 04 — Task tracking

Read `../conventions.md` first (severity scale, scoring, report template).

**Question:** Is work planned and traceable, or does the repo only show what
happened, never why?

## Investigate

- Any tracker at all: GitHub issues enabled/used, a BACKLOG/TODO file, project
  board references in commits or PRs.
- Traceability: do commits/PRs reference issues or any work item? Sample
  `git log --oneline -50` for issue refs (`#N`, ticket keys).
- TODO debt in code: `grep -rn "TODO\|FIXME\|HACK\|XXX" --include` source globs.
  Count them, date a sample via `git blame` — are they tracked anywhere, or a
  graveyard?
- Scope hygiene: do PRs/commits map to coherent units of work, or is every
  change a grab-bag?
- Roadmap: any statement of what's next vs. shipped (roadmap file, milestones)?

## Amateur / AI-built signals

- Dozens of stale AI-inserted `// TODO: implement error handling` comments.
- No issue, ticket, or backlog reference anywhere in history.
- A TODO.md last touched months before the newest code.

## Report

Write `audit/task-tracking.md` per the conventions template. Read-only.
