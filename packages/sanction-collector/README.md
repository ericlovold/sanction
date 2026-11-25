# Sanction collector (prototype)

Reads Claude Code and Codex usage counts from the session files those tools
already keep on your computer, and builds a signed, metadata-only batch for
Sanction. Design and rationale: `docs/plans/local-usage-collector.md`.

This prototype has no network code. It cannot send anything.

## What it reads

- Claude Code: `~/.claude/projects/*/*.jsonl` (or `CLAUDE_CONFIG_DIR`)
- Codex: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` and
  `~/.codex/archived_sessions/` (or `CODEX_HOME`)

Nothing else in those folders is opened: not credentials, not history, not
state databases. Symlinks are skipped.

## What would leave the device

Per tool, surface (CLI, IDE, app, exec, SDK), model, hashed session and hour:
request count and input, output, cache read, cache write and reasoning tokens.
For Codex, the plan's usage windows (percent used, window length, reset time).
Plus parser health counts so a format change is visible.

Never: prompts, responses, tool calls, file paths, working directories, git
remotes, emails, account ids, raw session ids.

## Try it

From the repo root, with the repo's dev dependencies installed:

```
npx tsx packages/sanction-collector/src/bin.ts scan
npx tsx packages/sanction-collector/src/bin.ts preview --tools codex --since 2026-11-01
```

`preview` prints the batch body that would be sent, indented for reading.
