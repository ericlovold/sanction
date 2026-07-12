---
name: cut-release
description: Use when the user says "cut a release", "cut vX.Y.Z", "ship the release", or when merged work has accumulated past the last tag and it's time to make it official. Runs the whole ritual - verify live state, bump package.json, stamp the changelog, open the cut PR, then hand the user release notes + a prefilled publish link, and verify Latest after they publish. Exists to make version/tag drift (the v0.2.0→v0.5.0 gap) structurally impossible.
---

# cut-release: version and tag move together, or not at all

A release is a claim: "this tag is this code." The failure mode this skill
kills is drift — package.json says one thing, the Releases page another,
and the changelog a third. The ritual keeps all three in lockstep.

## Step 1 — verify live state (never from memory)

```bash
git fetch origin
git ls-remote --tags origin                    # what's actually tagged
git log --oneline <last-tag>..origin/main      # the pack since the last tag
git show origin/main:package.json | grep version
```

Also: zero relevant open PRs the user expects in the pack (ask if unclear),
and CI green on main. If main is already past what the user thinks is
unreleased, say so — other sessions ship too.

## Step 2 — the cut PR (bump + stamp, nothing else)

On a fresh branch off main:

1. `package.json` version → the new version.
2. Changelog: a release-header entry (`version` field set) that *summarizes*
   the pack and points at the per-feature entries below it. While there,
   add any per-feature entry a merged PR is missing — a release is the
   natural drain point.
3. **Verify every count and claim in the entry against code** (tools
   registered, endpoints live — the "ten tools, not nine" lesson: grep the
   source, don't trust the draft).
4. Full gate, then PR. The diff should be version bump + changelog only.

## Step 3 — the publish handoff

After the cut PR merges (never before — the tag must contain the bump):

1. Write the release notes: highlights since the last tag, grouped by theme,
   changelog voice, honest boundaries stated. If the page will show a version
   jump (v0.2.0 → v0.5.0), the notes cover the whole gap, not just the last
   sprint — a public reader sees the jump.
2. Hand the user the file + a prefilled link:
   `https://github.com/<owner>/<repo>/releases/new?tag=vX.Y.Z&target=main&title=<urlencoded>`
   (target=main puts the tag on the merge commit; this environment can't
   push tags or create releases itself — the 403 is policy, don't fight it).

## Step 4 — verify after publish

When the user says published: `get_latest_release` + `git ls-remote --tags`
+ package.json on main. All three agree or the release isn't done. Note
whether main has already moved past the tag (it usually has — fine, that's
the next release's seed).

## Rules

- The bump rides a PR that merges BEFORE tagging — a tag that doesn't
  contain its own version bump is drift with extra steps.
- Notes are written for the public page: buyers and auditors read it, not
  just devs. No internal codenames, no PR-number soup in the prose.
- One release per coherent pack. If the pack has no theme, the notes will
  say so louder than you can.
