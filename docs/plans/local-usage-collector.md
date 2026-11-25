# Local usage collector for personal AI plans

> Track 3 of the "select your tools, see your usage" arc (2026-11-25). Tracks 1
> and 2 cover admin APIs and API-key billing. This track covers the plans that
> have no API at all: a person's own Claude Pro/Max, ChatGPT Plus/Pro, Cursor
> Pro. Prototype: `packages/sanction-collector` and `lib/collectorBatch.ts`.
> No migration, no route, nothing deployed.

## Verdict

- **Claude Code and Codex on personal plans: buildable now.** Both write every
  model call, with model and token counts, to local session files. Codex also
  writes the plan's own usage windows (the "you've used 41% of your weekly
  limit" numbers), which exist nowhere else locally.
- **Cursor individual Pro: not reliably buildable.** No personal API, OTel
  export is Enterprise-only and server-side, and the local state holds no
  dependable token counts. Teams already get it from the Cursor Admin API
  connector that ships today.
- **Gemini CLI: skip for now.** Google moved personal AI Pro and free users to
  Antigravity CLI. API-key users belong to track 2.
- **GitHub Copilot individual: not a collector job.** There is an official REST
  usage API with a personal token, so it is a connector (tracks 1 and 2).
- **ChatGPT and claude.ai chat apps: no local path.** Nothing is written on the
  device.

Honest framing for the onboarding vision: "click, connected" works where the
vendor has an API (tracks 1 and 2). For personal plans the best possible
experience is "install a small helper once, pick your tools, done". The
people using Claude Code and Codex are developers, so a one-line install is
acceptable to them; a menu-bar app is the non-technical version later.

## What each tool exposes on a personal plan

Formats verified on this machine on 2026-11-25 by running the real CLIs
(Claude Code 2.1.332, Codex 0.172.0, Gemini CLI 0.71.1) against a local fake
model, so the files are real and the content is not.

| Tool | Local usage data | Official telemetry | Stability | Plan-limit signal |
|---|---|---|---|---|
| Claude Code | `~/.claude/projects/<project>/<session>.jsonl` (or `CLAUDE_CONFIG_DIR`, or `~/.config/claude`). Assistant lines carry message id, model, input, output, cache read/write and thinking tokens. | OTel metrics and events on every plan, including `api_request` with tokens and `cost_usd`; `user.email` is attached by default ([monitoring-usage](https://code.claude.com/docs/en/monitoring-usage)) | "Internal to Claude Code and changes between versions" ([sessions](https://code.claude.com/docs/en/sessions)). Deleted after 30 days by default (`cleanupPeriodDays`, [settings-reference](https://code.claude.com/docs/en/settings-reference)) | Status line input has `rate_limits.five_hour` / `seven_day` used percentage for Pro/Max ([statusline](https://code.claude.com/docs/en/statusline)) |
| Codex | `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl` and `archived_sessions/`. `token_usage_record` per response (new), `token_count` running totals (older) | OTel opt-in, carries the account email ([config-advanced](https://developers.openai.com/codex/config-advanced)). A model-request hook with token usage ([hooks](https://developers.openai.com/codex/hooks)) | The hooks doc says the transcript "format isn't a stable interface". Flag-gated zstd compression and a SQLite move are in flight | `token_count.rate_limits`: primary and secondary windows with used percent, window length, reset time, plan type. Only in the rollouts |
| Cursor Pro | State DB token counts read as 0; never read its auth rows | OTel export is Enterprise ([opentelemetry-export](https://cursor.com/docs/enterprise/opentelemetry-export)); hooks don't document token fields ([hooks](https://cursor.com/docs/hooks)) | n/a | none |
| Gemini CLI | `~/.gemini/tmp/<name>/chats/session-*.jsonl` with token counts | `logPrompts` defaults to on | Personal plans moved to Antigravity CLI ([gcli-migration](https://antigravity.google/docs/gcli-migration)) | none |
| Copilot | n/a | REST usage API with a personal token ([billing usage](https://docs.github.com/en/rest/billing/usage)) | Official | n/a |

What Sanction already has: `POST /v1/usage/otlp/[source]` takes Claude Code and
Codex OTel logs keyed by an Agent seat key (`docs/DEVELOPER-USAGE.md`). It
works, but setup means editing env vars or `~/.codex/config.toml` with a raw
key, it has no history, and it cannot see Codex plan windows. The collector
fills exactly those gaps.

## Design

```
 Claude Code / Codex session files          Sanction
 ──────────────────────────────────         ─────────────────────────────
 discover  only the tools' session folders
 parse     versioned parsers -> UsageRecord / PlanWindow  (allow-list)
 rollup    hourly totals, session id hashed
 batch     Ed25519-signed JSON  ─────HTTPS────>  verify signature on raw bytes
                                                  strict schema, freshness
                                                  identity from the device row
                                                  -> UsageFact (+ plan windows)
```

### Private by default

- Nothing leaves the device until the person pairs it and ticks the tools to
  report. Tools left unticked are never read.
- Discovery looks only inside each tool's own folder, only at session-file
  shapes, and skips symlinks. `auth.json`, `history.jsonl`, `state_*.sqlite`
  and `.claude.json` sit in the same folders and are never opened, because no
  rule matches them (`src/discover.ts`).
- Parsers copy named fields into `UsageRecord` and `PlanWindow` and nothing
  else (`src/record.ts`). Model names, ids and versions must match tight
  patterns, so free text cannot ride in through one of them.
- Prompts, responses, tool input and output, paths, working directories, git
  remotes, emails and account ids have no field to land in. The session id is
  sent as `sha256("<tool>:<id>")`, cut to 32 hex characters.
- `sanction-collector preview` prints the exact body that would be sent.
- The server schema is strict: an unknown field is a refusal, not something
  silently dropped. A test plants canaries (a prompt, a path, an API key, an
  email, every raw id) in every readable field and asserts none reach the batch.

### Pairing and signing

1. The person picks their tools in Sanction and clicks "Connect this computer".
2. The helper makes an Ed25519 key pair, keeps the private key in the OS
   keychain, and opens the browser to a short pairing code (the device-code
   pattern, as `gh auth login` does).
3. Signed in, the person confirms; Sanction stores the public key with a
   server-made `deviceId`, the person and the org wallet.
4. Each batch is signed over its exact bytes. The server verifies before it
   parses (`lib/collectorBatch.ts`), takes the person from the device row and
   never from the batch, and only accepts batches newer than the last one, so
   a late or replayed batch cannot lower a total.
5. Revoking the device in Sanction stops it at the next batch.

### Versioned parsers and drift

Both vendors call these formats internal, so drift is the main risk and the
design treats it as normal:

- Each parser has an id (`claude-code/transcript@1`, `codex/rollout@1`) and
  sends counts only: files, lines, records, malformed lines, unknown line
  types, usage lines it could not read, skipped files, tool versions seen.
- `parserDrift()` turns those into plain warnings ("found usage lines but
  could read none"). Without this, a format change looks exactly like a person
  who stopped using the tool.
- Dedupe follows the formats: Claude Code writes one response as several
  lines, so it counts once per message id and keeps the largest counts (early
  streaming lines carry placeholders). Codex counts once per `response_id`,
  and older rollouts fall back to differences between running totals.
- Each batch carries whole-hour totals per session, which replace what the
  server holds. When any file of a Claude session changes, the whole session
  is read again so a total is never lowered by a partial read.

**Recommended CI addition:** a nightly job that installs the latest Claude
Code and Codex, runs one turn each against a local fake model (the approach
used to verify formats here), and runs the parsers over the real output. A
format change then fails our build the night it ships, before users see a
blank dashboard.

### Install story

- **v1, developers (this quarter):** the Sanction plugin for Claude Code
  (`claude-plugin/` already exists) and a Codex hook run the helper after each
  session; an hourly timer catches the rest. One install command, one browser
  confirmation. No edits to the person's tool settings.
- **v2, everyone:** a signed menu-bar app (macOS notarized, Windows MSIX) whose
  first screen is Eric's "which tools do you use?" checklist, with a pause
  switch and a "what gets sent" view.
- **Org rollout:** the same helper pushed by MDM, with Claude Code's managed
  settings or Codex's managed configuration enabling the hook.
- **Fallback when a format breaks:** the existing OTLP endpoint. The helper
  can later run a localhost OTel receiver and apply the same allow-list, so
  OTel never sends `user.email` off the device.

Recommendation: files first, triggered by hooks. They need no change to the
person's tool config, carry history, and are the only source of Codex plan
windows. OTel stays the resilience path.

## Shared schema proposal (for tracks 1 and 2)

Keep `UsageFact` as the one hourly grain every source writes into. The
collector already maps onto it unchanged (`normalizeCollectorFacts`): Claude
Code becomes `provider: anthropic, surface: claude_code`; Codex becomes
`provider: openai, surface: agent` (or `ide`), `costBasis: included`,
`costNanos: 0`, `rawIdentity` from the paired person.

Proposed additions, for one migration agreed across the three tracks:

| Change | Why |
|---|---|
| `UsageFact.tool`: `claude_code` \| `claude_ai` \| `codex` \| `chatgpt` \| `cursor` \| `copilot` \| `gemini` \| `api` | The product the person thinks they use. `provider` is who bills, `surface` is where in the product. The tool picker and "show only my tools" key on this |
| `UsageFact.source`: `admin_api` \| `billing_api` \| `otlp` \| `collector` \| `upload` | One person's Claude Code usage can arrive by two roads; the dashboard needs to pick one per person, tool and hour |
| `UsageFact.personId?`, `deviceId?`, `planRef?` | Person resolved inside Sanction; which device reported; `claude_max_5x`, `chatgpt_plus` when known |
| `UsageConnection.kind`, unique on `[walletId, provider, kind]` | Today one connection per provider per wallet. A collector device needs its own connection row so its `dedupeKey` space stays separate |
| `CollectorDevice` (wallet, person, public key, platform, tools, pairedAt, lastBatchAt, revokedAt) | Pairing, signing, revocation |
| `PlanWindowSnapshot` (person, tool, limitId, window, windowMinutes, hourStart, peak and last percent, resetsAt, planType) | Codex plan windows now; Claude status-line windows later |

Org is the root wallet, team a child wallet; both already exist. "Connected"
for the first dashboard means a tool with an active connection that has
written a fact, or a paired device that has reported that tool, so no empty
cards. Source precedence: an admin-API fact wins for money; collector facts
count for personal plans the admin API cannot see (Claude Pro/Max is not in
Anthropic's reporting, per `lib/connectors/registry.ts`).

## Open decisions for Eric

1. Files first with hooks (recommended), or OTel first.
2. Whether a personal plan's usage may report into an employer's org at all,
   and the consent screen that goes with it.
3. The shared schema above, agreed with tracks 1 and 2, then one migration.
   It needs your go: production applies migrations on the production deploy.

## Prototype status

- `packages/sanction-collector`: discover, Claude Code and Codex parsers,
  rollup, signed batch, and a CLI (`scan`, `preview`, `keygen`) with no
  network code. MIT, private, unpublished.
- `lib/collectorBatch.ts`: signature check, strict schema, freshness and
  range checks, mapping to `FactInput`, drift warnings. Not wired to a route.
- Tests: `tests/collector.test.ts`, `tests/collectorBatch.test.ts`, on
  synthetic fixtures in `tests/fixtures/collector/`.
- Not built: the pairing endpoint and table, the upload, keychain storage,
  hooks, the app, Claude status-line windows, zstd rollouts.
