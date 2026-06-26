# Sanction + Vercel AI SDK

> Route your AI SDK calls through Sanction's gateway to meter every token and cap
> spend — per agent, per tenant, across providers — without changing how you call
> the model. You keep your own provider key; Sanction just sits in front of it.

The whole integration is two lines of config: **point the provider's `baseURL` at
Sanction and add the `x-sanction-key` header.** Everything else is normal AI SDK.

---

## Install

```bash
npm i ai @ai-sdk/openai-compatible @ai-sdk/anthropic @ai-sdk/google
```

You need a Sanction **agent key** (`pxy_…`) — one per tenant. See the
[Integration Runbook](INTEGRATION.md) to provision them. In these examples
`AGENT_KEY` is that `pxy_…` key.

---

## OpenAI

Use **`@ai-sdk/openai-compatible`**, not the native `@ai-sdk/openai` — see the note
at the bottom; it's the difference between Sanction metering your calls and not.

```ts
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { generateText } from "ai"

const openai = createOpenAICompatible({
  name: "openai",
  apiKey: process.env.OPENAI_API_KEY,                       // your key — forwarded upstream
  baseURL: "https://getsanction.com/api/gateway/openai/v1",
  headers: { "x-sanction-key": process.env.AGENT_KEY! },    // meters + caps
  includeUsage: true,                                       // so streamed calls are metered too
})

const { text } = await generateText({
  model: openai("gpt-4o-mini"),
  prompt: "Hello from Sanction",
})
```

## Anthropic

```ts
import { createAnthropic } from "@ai-sdk/anthropic"
import { generateText } from "ai"

const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,                       // your key — forwarded
  baseURL: "https://getsanction.com/api/gateway/anthropic/v1", // AI SDK appends /messages
  headers: { "x-sanction-key": process.env.AGENT_KEY! },
})

const { text } = await generateText({
  model: anthropic("claude-haiku-4-5-20251001"),
  prompt: "Hello from Sanction",
})
```

## Google (Gemini)

```ts
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { generateText } from "ai"

const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,                          // your key — forwarded
  baseURL: "https://getsanction.com/api/gateway/gemini/v1beta",
  headers: { "x-sanction-key": process.env.AGENT_KEY! },
})

const { text } = await generateText({
  model: google("gemini-2.5-flash"),
  prompt: "Hello from Sanction",
})
```

---

## Multi-tenant: one provider, per-request tenant key

For a platform with many tenants, create **one** provider instance (your provider
key) and pass each tenant's `x-sanction-key` **per request** — no need to rebuild
the client per tenant:

```ts
const openai = createOpenAICompatible({
  name: "openai",
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "https://getsanction.com/api/gateway/openai/v1",
  includeUsage: true,
})

async function runForTenant(tenantAgentKey: string, prompt: string) {
  return generateText({
    model: openai("gpt-4o-mini"),
    prompt,
    headers: { "x-sanction-key": tenantAgentKey }, // per-tenant, per call
  })
}
```

`streamText` takes the same per-call `headers`. Map `tenantId → agentKey` in your
resolver (see the [runbook](INTEGRATION.md)).

---

## When the budget is hit

When a tenant's daily token budget is exhausted, the gateway returns **402 before
the call reaches the provider** — the AI SDK surfaces it as a thrown error. That's
the governance payoff: your code *learns* the cap, it doesn't silently overspend.

```ts
import { APICallError } from "ai"

try {
  await generateText({ model: openai("gpt-4o-mini"), prompt, headers: { "x-sanction-key": tenantAgentKey } })
} catch (err) {
  if (APICallError.isInstance(err) && err.statusCode === 402) {
    // tenant is over budget — degrade gracefully, queue, or notify the owner
  } else {
    throw err
  }
}
```

Set budgets and thresholds with the control-plane API — see the
[Integration Runbook](INTEGRATION.md).

---

## OpenAI: compatible vs. native provider

Either works — Sanction meters **both** OpenAI's Chat Completions (what
`@ai-sdk/openai-compatible` uses) and the **Responses API** (what the native
`@ai-sdk/openai` provider uses by default). We show the compatible provider above
because it's explicit about `includeUsage` for streaming, but the native
`@ai-sdk/openai` works the same way — just set `baseURL` + `headers` on
`createOpenAI(...)`. Anthropic and Google's native providers meter correctly too.

> **Degradation:** the gateway is in-path. If you need a fallback when it's slow or
> down, wrap these calls so an error falls back to the provider's own base URL —
> you already hold the provider key. See the runbook's circuit-breaker section.
