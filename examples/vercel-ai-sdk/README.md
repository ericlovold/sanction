# Vercel AI SDK example — metered + governed in ~2 minutes

Runs the two first-successes of the [Vercel AI SDK guide](../../docs/VERCEL-AI-SDK.md)
as one script: a model call metered through Sanction's gateway, then a real
pre-spend `/authorize` decision.

```bash
# from the repo root:
source <(bash examples/setup.sh)          # 1. wallet + agent key → env
export ANTHROPIC_API_KEY="sk-ant-..."     # 2. your provider key (forwarded)

cd examples/vercel-ai-sdk
npm install                               # 3. ai + @ai-sdk/anthropic
npm start
```

Expected output:

```
Model (metered through Sanction): <one-sentence recommendation>
Authorize $29 subscribe → approved
Proceed with the purchase — the decision is in your audit feed.
```

Depending on your wallet's default policy the authorize step may come back
`escalated` (approve it from the dashboard, or with the `x-mgmt-key` printed
by setup.sh) or `denied` — all three are the product working. The metered
call appears in your dashboard's token usage immediately.

A 402 from the model call means the agent's daily token budget is spent —
the gateway stopped the call before it reached Anthropic.

OpenAI and Gemini work the same way (different `baseURL` + provider package);
see the [guide](../../docs/VERCEL-AI-SDK.md) for those variants and per-tenant
key patterns.
