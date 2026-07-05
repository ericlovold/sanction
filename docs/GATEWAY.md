# Sanction Gateway — zero-instrumentation cost governance

Point your LLM client at Sanction instead of the provider. Sanction forwards the
call, reads token usage off the response, meters it against the agent's budget,
and returns the answer untouched after metering succeeds. **No `log_tokens` call
to remember** — change a base URL and add one header.

If the agent has already spent its daily token budget, the gateway returns `402`
**before** calling the provider — the spend is stopped, not just recorded.

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

## OpenAI (Python SDK)

```python
from openai import OpenAI
client = OpenAI(
    base_url="https://getsanction.com/api/gateway/openai/v1",
    api_key="<OPENAI_API_KEY>",
    default_headers={"x-sanction-key": "pxy_…"},
)
client.chat.completions.create(model="gpt-4o-mini",
                               messages=[{"role": "user", "content": "hi"}])
```

## Gemini (REST)

```bash
curl -X POST \
  "https://getsanction.com/api/gateway/gemini/v1beta/models/gemini-flash-latest:generateContent?key=$GOOGLE_API_KEY" \
  -H "x-sanction-key: pxy_…" -H "content-type: application/json" \
  -d '{"contents":[{"parts":[{"text":"hi"}]}]}'
```

## What it meters

Every call lands in your Spend dashboard by agent, model, and `gateway:<provider>`
task label, against the same daily token budget the policy enforces. Set per-agent
budgets with `PATCH /api/v1/agents`.

## Streaming

Streaming is metered and **stays live** — the gateway tees the SSE stream to your
client untouched, so tokens arrive as the provider generates them, and settles the
meter when the stream ends:
- **Anthropic** & **Gemini** — usage is in the stream by default; metered automatically.
- **OpenAI** — set `stream_options: {include_usage: true}` so the final chunk carries
  usage; otherwise a streamed OpenAI call can't be metered.

## Notes / limits

- Pricing is an **estimate** per model (see `lib/gateway.ts`); tune as needed.
- **Fail-closed is enforced at the budget gate**, before the provider is called:
  if the daily token budget is exhausted, or Sanction can't read spend state
  (a DB outage makes the pre-call read throw), the call is stopped and the
  provider is never reached. For a **non-streaming (JSON)** response, if usage
  can't be metered afterward, Sanction withholds the body and returns `502`.
  For a **streaming** response — where the client has already begun receiving
  bytes and withholding is impossible — the meter write is retried at stream
  end; a hard failure is logged and left as a single-call under-count rather
  than breaking the stream.
- The agent still holds the provider key today. A vault-injected mode (the agent
  never sees the provider key) is the natural next step.
