# Developer usage and a native approval test

Sanction accepts **OTLP HTTP JSON logs** from Claude Code and Codex. The
Developer usage page shows sessions, reported token counts, available cost
estimates, and last delivery. This is client-reported observation, not a billing
invoice or a guarantee that every client is connected. It does not stop vendor
auto-refills. Codex here means the local client, not ChatGPT web.

## Connect a client

Use [guided connection setup](/dashboard/connect) to choose a tool and seat,
copy its configuration, and check delivery for that seat. Delivery history
does not attest to a new configuration or enforcement.

Create a dedicated seat for each client in **Roster → Add agent**. Keep its key
in your local environment or private user configuration, never in the repo.
Use **Roster → Developer usage** to verify delivery. The page covers the selected
wallet, not its descendants, and at most the latest 1,000 events from seven days.

### Claude Code

Set these variables in the terminal that will launch Claude Code. Enter your
seat key locally as `SANCTION_AGENT_KEY` first:

```bash
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export OTEL_LOGS_EXPORTER=otlp
export OTEL_METRICS_EXPORTER=none
export OTEL_EXPORTER_OTLP_LOGS_PROTOCOL=http/json
export OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=https://getsanction.com/api/v1/usage/otlp/claude-code
export OTEL_EXPORTER_OTLP_LOGS_HEADERS="x-api-key=$SANCTION_AGENT_KEY"
export OTEL_LOG_USER_PROMPTS=0
export OTEL_LOG_ASSISTANT_RESPONSES=0
export OTEL_LOG_TOOL_DETAILS=0
claude
```

Merge with your existing telemetry setup deliberately: these variables change
where this client's logs go. Sanction consumes logs only; do not also send
cumulative metrics or traces as usage. Administrator-managed settings can
override local export settings.

### Codex

Merge this block into your **private user-level** `~/.codex/config.toml`, replacing
`YOUR_SEAT_KEY` locally. Do not put it in project configuration or duplicate an
existing `[otel]` table. Protect the file because the header contains a key.

```toml
[otel]
log_user_prompt = false
exporter = { otlp-http = { endpoint = "https://getsanction.com/api/v1/usage/otlp/codex", protocol = "json", headers = { "x-api-key" = "YOUR_SEAT_KEY" } } }
```

Start a new Codex process, run a task, and allow the exporter to flush. Missing
pricing stays **Unavailable**; Sanction does not substitute an API price for a
subscription charge.

### What is retained

Only selected fields: source, hashed event identity, client session ID, coarse
event type, model, token counts, optional estimated cost, original event time,
and receipt time. Prompt contents, tool arguments/outputs, user emails, and
resource attribute bags are discarded by ingestion. Native exporters can send
other fields in transit; Sanction does not retain the raw envelope. Do not enable
prompt or tool-detail collection for this integration.

Supported events: Claude `api_request`, `user_prompt`, `tool_result`; Codex
conversation starts, user prompts, tool results/decisions, and completed stream
usage events. Other events are ignored. Per-event estimates are never added to
the governed token ledger, so using both a gateway and telemetry does not debit
the same call twice. Multiple seat keys observing the same client session are
separate sources: configure only one seat per client.

Batches must be uncompressed JSON, at most 1 MiB and 500 log records. Retries
with the same event identity and seat are idempotent. Events keep their original
time; future timestamps beyond five minutes are rejected. Old exports do not
become today's usage. A valid active key may report past activity even when its
wallet is frozen or over budget; revoked or expired keys cannot ingest.

## Prove one Claude Code action is governed

Use a **dedicated test wallet and seat**, then apply the **Claude Code approval
test** policy pack in Policy. It escalates `claude-code.Read` and denies unlisted
tools. Existing parent restrictions still apply. This pack is intentionally
restrictive; it is not a general coding policy.

1. Create a harmless local file containing a short note.
2. Set `SANCTION_AGENT_KEY` to that test seat's key in the terminal launching
   Claude Code. Use Node 20 or newer.
3. Merge this hook into your private Claude settings, replacing the script path
   with the absolute path in your Sanction checkout. Do not replace other hooks.

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Read",
      "hooks": [{
        "type": "command",
        "command": "node /absolute/path/to/sanction/scripts/developer/claude-hook.mjs",
        "timeout": 15
      }]
    }]
  }
}
```

4. Start Claude Code normally (not `--bare`, which skips hooks). Ask it to read
   the harmless file with `Read`. Sanction refuses and identifies the request.
5. Open Sanction's Approvals inbox, inspect the exact working directory and tool
   input, and approve it.
6. Retry the identical read in the **same Claude session**. The hook retrieves
   and consumes the one-use grant before permitting the tool.

Changing the working directory or tool input requires another approval. An
expired or consumed grant never authorizes execution. A successful later read
of the same file starts a new decision cycle; approval is not permanent.

The example matcher covers **Read only**. It does not govern Bash, installs,
other tools, model calls, or billing. To cover more tools, install matching hooks
and configure their exact `claude-code.<tool_name>` policy names. Tool arguments
are bound for approval; shell text is not parsed for safety by this adapter.
Host hooks can be disabled by whoever controls the host settings. Do not call
this a tamper-proof sandbox. Telemetry delivery does not attest that hooks run.

Network/configuration failures and observe-mode responses produce a denial.
The hook uses an eight-second network timeout and does not wait for a human
inside the hook. Pending state contains only request IDs and idempotency keys,
under `~/.local/state/sanction/hooks` (override with `SANCTION_HOOK_STATE_DIR`).
For denied/expired requests or a lock left by a killed process, stop the relevant
Claude session before removing that test session's pending state; retrying then
starts a new approval. Never remove a lock while a hook is running.

## Evidence and limits

Unit and database tests cover duplicate delivery, wallet isolation, missing
prices, changed working directory/input, concurrent redemption, expiry, and
outage refusal. Local verification with Claude Code 2.1.266 and Codex CLI 0.144.1 uses a fake model provider: it tests
native export/hook behavior without paid calls, and does not establish billing
accuracy or production deployment status.

References: [Claude telemetry](https://code.claude.com/docs/en/monitoring-usage),
[Claude hooks](https://code.claude.com/docs/en/hooks),
[Codex telemetry](https://learn.chatgpt.com/docs/agent-approvals-security#monitoring-and-telemetry),
[Codex configuration](https://learn.chatgpt.com/docs/config-file/config-reference).
