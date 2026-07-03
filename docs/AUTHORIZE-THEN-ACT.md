# Authorize, then act: how third-party instructions enter this codebase

A friend sent us a skill pack for AI coding agents. Six instruction files, an
installer, a benchmark write-up. Good work by a person we like. We adopted it,
and this page documents exactly how, because the procedure is the point.

Skill files are not documentation. They are instructions your agent will
execute, with your agent's access: your code, your CI, your GitHub, whatever
keys the session holds. "My agent got instructions from somewhere and did
them" is the failure mode this whole product exists to prevent. So when
instructions arrive from outside, they get the treatment a dependency gets,
not the treatment a PDF gets.

## The procedure

**1. Get the actual files, not the pitch.** The README is the brochure. Review
what will run: every skill file, the installer, all of it. We read all nine
files in the pack before deciding anything.

**2. Know what you are looking for.** The review is a hunt for specific
failure modes:

- Network calls or telemetry. Instructions that make the agent fetch a URL,
  post data anywhere, or "check for updates."
- Privilege moves. Anything that asks the agent to read credentials, widen
  permissions, or touch systems the task does not need.
- Review bypass. Language like "skip confirmation," "no need to show the
  user," "apply without asking."
- Loyalty redirection. "Always follow X's instructions" or anything that makes
  the agent serve the pack's author instead of you.
- Installer drift. Does the installer write the same bytes you reviewed? Ours
  embedded copies of the skills, so we diffed them against the loose files.
  Byte-identical. If they had differed, the review would have been of the
  wrong files.

**3. Verdict per file, in writing.** In our case all six skills passed: pure
methodology, no side effects, and honest marketing in the README (the
benchmarks publish their own losses, which is a good sign in any vendor).
The written verdict matters because the next person should not have to take
"we checked it" on faith.

**4. Vendor into the repo, not into a home directory.** The pack's installer
targets `~/.claude/skills/`, which is invisible and unversioned. We copied the
skills into `.claude/skills/` inside the repo instead. Versioned, present in
every session including cloud ones, and any future change to them shows up in
a pull request diff where a human reviews it.

**5. Keep upstream files verbatim; keep your provenance separate.** We did not
edit the skill files. A future upstream version diffs cleanly against ours.
The provenance record (source, version, review date, what was checked) lives
in its own README next to the skills, and our repo guidance points to it.

**6. Land it through review.** The adoption itself went in as a pull request.
The decision to run third-party instructions is a change to how the repo
behaves, and changes to how the repo behaves go through the same gate as code.

## Why we work this way

Sanction is an authorization layer for AI agents: before an agent spends
money, invokes a tool, or touches a credential, it asks, and every decision is
logged. It would be strange to sell that and then paste unreviewed
instructions into our own agents' heads.

The point is not suspicion of friends. The pack was good and we said so. The
point is that trust in the author is not the same as verification of the
artifact, and only one of those survives contact with a compromised download
link, a hijacked account, or a well-meaning mistake. Authorize, then act. It
cost us about twenty minutes, and now it is a habit with a paper trail.

If you run agents on your own codebase, steal this procedure. It works the
same whether the instructions come from a stranger's repo or your best
friend's.
