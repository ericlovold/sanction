# 01 — Source control

Read `../conventions.md` first (severity scale, scoring, report template).

**Question:** Is the repository's history a professional record, or a liability?

## Investigate

- Secrets in history, not just HEAD: `git log -p` grep for key patterns
  (`AKIA`, `sk_`, `pxy_`, `-----BEGIN`, `password=`, `token=`), plus `.env`
  files ever committed (`git log --all --diff-filter=A -- '*.env*'`).
- Junk in the tree or history: `node_modules/`, build output, editor droppings
  (`.DS_Store`), multi-MB binaries (`git rev-list --objects --all` piped to size sort).
- `.gitignore` quality: does it cover env files, generated code, build output?
  Anything tracked that the ignore file says shouldn't be?
- Remote and backup posture: is there a remote? Is main pushed? Unpushed local-only work?
- Commit hygiene: message quality (`git log --oneline -50`), giant "WIP"/"fix"
  blobs, commits touching hundreds of files, whether history shows any branching
  discipline or is 100% direct-to-main (overlaps topic 08 — note it, don't re-score it).

## Amateur / AI-built signals

- A commit removing a secret that remains recoverable in history.
- Commit messages that are AI-generated boilerplate mismatched to the diff.
- Entire project imported as one initial commit, then near-empty history.

## Report

Write `audit/source-control.md` per the conventions template. Read-only —
never rewrite history, never touch git state beyond reads.
