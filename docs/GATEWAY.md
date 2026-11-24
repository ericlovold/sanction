# Sanction Gateway — zero-instrumentation cost governance

Point your LLM client at Sanction instead of the provider. Sanction forwards the
call, reads token usage off the response, meters it against the agent's budget,
and returns the answer untouched after metering succeeds. **No `log_tokens` call
to remember** — change a base URL and add one header.

Before a metered generation starts, the gateway reserves its estimated maximum
cost against the seat's daily/monthly budgets and every ancestor's pooled daily
token cap. Recorded usage **plus outstanding reservations** must fit. Calls that
do not fit receive `402` before reaching the provider. Concurrent sibling seats
and self-reported `/tokens` writes compete for the same capacity.

Base URL: `https://getsanction.com/api/gateway/<provider>`
Auth: `x-sanction-key: pxy_…` (your agent key). Your provider key is forwarded as usual.

## Anthropic (Python SDK)

```python
from anthropic import Anthropic
client = Anthropic(
    base_url="https://getsanction.com/api/gateway/anthropic",
    api_key="<ANTHROPIC_API_KEY>",
    default_headers={"x-sanction-key": "pxy_…"},
)
client.messages.create(model="claude-haiku-4-5-20251001", max_tokens=100,
                       messages=[{"role": "user", "content": "hi"}])
# → metered automatically as gateway:anthropic
```

## Claude Code

Claude Code can send its model traffic through the gateway, so a seat's token
budget is a hard stop for a coding session. Set two variables before starting
it (Claude Code 2.1.227 or newer):

```bash
export ANTHROPIC_BASE_URL=https://getsanction.com/api/gateway/anthropic
export ANTHROPIC_CUSTOM_HEADERS="x-sanction-key: pxy_…"
```

Your existing Claude login or API key keeps authenticating to Anthropic; the
gateway forwards it unchanged. When the budget cannot cover a request, Claude
Code shows `API Error: 402` with `GATEWAY_BUDGET_EXCEEDED` and the limit, and
does not retry.

Checked against Claude Code 2.1.329 on a local gateway with a Claude
subscription login: a multi-tool session (Bash, Read, Write, Edit and a
subagent) had every request accepted, and a budget set just above recorded
spend stopped the next session before it reached Anthropic.

- **Leave headroom.** Each request reserves its largest possible cost before it
  is sent. A Claude Code request carries the whole tool list, so a small prompt
  to a Haiku model reserved about $0.88 and then cost under one cent. Sessions
  stop when the remaining budget is smaller than one reservation, not at zero.
- **Subscription plans.** The figure metered is what the same tokens would cost
  at API prices. It is a usable cap, not what a flat-rate plan charges.
- **Not supported yet.** Images and PDFs in the conversation, and Claude Code's
  web search, are refused with a `400`. After a refusal Claude Code retries
  with every tool definition inlined, which is slower and costs more.
- **The key is in your environment.** Keep `ANTHROPIC_CUSTOM_HEADERS` out of
  project settings files that are committed.

## OpenAI (Python SDK)

```python
from openai import OpenAI
client = OpenAI(
    base_url="https://getsanction.com/api/gateway/openai/v1",
    api_key="<OPENAI_API_KEY>",
    default_headers={"x-sanction-key": "pxy_…"},
)
client.chat.completions.create(model="gpt-4o-mini", max_completion_tokens=100,
                               messages=[{"role": "user", "content": "hi"}])
```

## Gemini (REST)

```bash
curl -X POST \
  "https://getsanction.com/api/gateway/gemini/v1beta/models/gemini-flash-latest:generateContent?key=$GOOGLE_API_KEY" \
  -H "x-sanction-key: pxy_…" -H "content-type: application/json" \
  -d '{"contents":[{"parts":[{"text":"hi"}]}],"generationConfig":{"maxOutputTokens":100,"thinkingConfig":{"thinkingBudget":0}}}'
```

## What it meters

Calls with reported usage land in your Spend dashboard by agent, model, and `gateway:<provider>`
task label, against the same daily token budget the policy enforces. Set per-agent
budgets with `PATCH /api/v1/agents`.

## Streaming

Streaming is metered and **stays live** — the gateway tees the SSE stream to your
client untouched, so tokens arrive as the provider generates them, and settles the
meter when the stream ends:
- **Anthropic** & **Gemini** — usage is in the stream by default; metered automatically.
- **OpenAI Chat Completions** — Sanction forces `stream_options.include_usage`,
  and renames a legacy `max_tokens` to `max_completion_tokens` (the limit that
  includes reasoning tokens). Nothing else in the request is changed.
- A final usage report and terminal event settle the reservation. Cancellation,
  an incomplete stream, or missing usage retains the hold; restarting the
  gateway does not free it. After 15 minutes it is charged as spend dated at
  admission (see Settlement below).

## Stored provider keys: metered endpoints only

When a call carries no provider auth, the gateway injects the key you connected
under Dashboard → Providers, but only for endpoints whose responses it meters:
Anthropic `POST /v1/messages` (and `/v1/messages/count_tokens`); OpenAI
`POST /v1/chat/completions`, `/v1/responses`, `/v1/embeddings`, `/v1/completions`;
Gemini `POST .../models/{model}:generateContent`
and `:streamGenerateContent`. Any other path (batches, files, fine-tuning…)
returns `403` with `code: "GATEWAY_PATH_NOT_METERED"` and is never sent upstream,
because it would spend on the stored key with nothing metered. OpenAI
`/v1/responses` with `background: true` gets the same `403`: background mode
returns no usage and settles through an unmetered retrieval. A request that
brings its own provider auth header may still retrieve metadata with GET.
Unmetered POST paths are rejected with either credential source; ownership of
the provider key does not bypass reservations. GET retrievals do not charge a
second time for usage already reported by an earlier generation.

## Reservation sizing and supported requests

Sanction sizes a hold from the forwarded UTF-8 request bytes, framing allowance,
and the request's maximum output tokens using its model pricing table. Anthropic
input reserves the highest supported prompt-cache write multiplier.

**Sanction adds no output limit to your request**, so it never truncates an
answer (the only rewrites are the two Chat Completions fields noted above). If you set none,
the hold covers a 131,072-token response, the largest the gateway accepts, and a budget
too small for that returns a `402` with a `remediation` field explaining which
limit to set. Setting `max_completion_tokens`, `max_output_tokens`,
`max_tokens`, or `generationConfig.maxOutputTokens` reserves only what you ask
for. Anthropic requires `max_tokens`, as its API does.

Thinking is bounded by the same limit. Anthropic documents `max_tokens` as the
ceiling on all output, thinking included, and Google documents
`maxOutputTokens` as covering thinking and answer together, so every thinking
setting is admitted: Claude `adaptive`, `enabled` (with or without interleaved
thinking), `between_tools`, and `disabled`; Gemini automatic thinking,
`thinkingBudget` (including `-1`), and `thinkingLevel`.

This first reservation adapter supports bounded text generation and text
embeddings. Hidden or unbounded inputs are rejected before dispatch: media,
provider-stored conversations/cache references, background generation,
server-side tools/retrieval, and multiple candidates. Perplexity generation is
currently rejected because its search work cannot be bounded from the request.
A `400` response explains which input needs to change. Function definitions and
ordinary local tool results are supported where their text is in the request.
Responses assistant messages and function calls can be replayed inline, including
their validated metadata. Claude tool loops with thinking are supported,
including replayed `thinking` and `redacted_thinking` blocks. So is what Claude
Code adds to a request: context edits that clear earlier thinking or tool
results, with their options held to Anthropic's documented shapes (clearing
removes input; the hold adds a fixed allowance for the warning Anthropic may
send the model as tool-result clearing nears), system messages mid-conversation with
per-turn output settings and inline client tool definitions, deferred tool
loading, and tool calls marked as made directly by the model. Models that keep
prior reasoning bill it as input; Anthropic documents the `signature` (and
redacted `data`) as an encrypted copy of the full reasoning, so the hold counts
those bytes twice to bound it.

**Compatibility change:** requests that previously passed through a metered
endpoint may now need an explicit bound or a supported text-only shape. The
Anthropic token-count endpoint remains non-generating and does not reserve.

## Settlement and failure handling

Each reservation has one associated usage log. A successful settlement atomically
records usage and releases the unused portion. Retrying settlement cannot charge
twice. The price rates are captured at admission so a deployment cannot change
the basis halfway through a call.

Gemini reports that omit the candidate count settle only when its total token
count accounts for prompt, thinking, and candidate usage. Missing or inconsistent
totals keep the hold. This follows Google's
[usage-counter definitions](https://ai.google.dev/api/generate-content#UsageMetadata).
Malformed stream records and cancellation cannot release a hold based on earlier
usage alone. Budget denials have terminal audit records and return a `request_id`.

JSON request rejections (`400`, `401`, `403`, `404`, `422`, `429`) without
contradictory usage evidence release unused holds. Network failures, redirects, `408`, server errors, cancelled
streams, and missing usage remain charged conservatively. Partial usage is
recorded without freeing the remaining hold. Database failure before reservation
prevents dispatch; database failure after dispatch leaves the committed hold in
place.

A hold occupies every budget window while its call can still be running. Once
it is still pending or uncertain **15 minutes after admission** (the gateway
route runs for at most 300 seconds, with settlement retries inside that window),
it is charged its full estimate, or its observed usage if that is higher, as
spend dated when it was admitted. Daily seat and pool capacity come back at the
next midnight; monthly capacity at the next month. The charge never drops below
the estimate, so a client that disconnects before the final usage event cannot
lower its own cost. A settlement that arrives later replaces the estimate with
the actual cost, counted once. There is no dashboard release control in this slice.

## What the cap guarantees

The concurrency guarantee is that admitted **estimated capacity** plus recorded
usage fits every applicable cap when admission commits. Prices and input token
counts are estimates, not a guarantee about a provider invoice. Provider-reported
usage above a reservation is recorded in full, even if that crosses a cap; later
admissions stop. Sanction never clamps observed cost to make a cap appear to hold.
Non-token provider fees and calls sent directly to a provider are outside this
accounting.

The Spend dashboard reports observed usage. Outstanding holds are separate
`GatewayReservation` records and are included in admission decisions, including
the `spent_usd` occupancy returned with a reservation denial.
