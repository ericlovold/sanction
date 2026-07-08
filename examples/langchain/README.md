# LangChain example — metered + governed in ~2 minutes

Runs the two first-successes of the [LangChain guide](../../docs/LANGCHAIN.md)
as one script: a LangChain call metered through Sanction's gateway, then a
real pre-spend `/authorize` decision.

```bash
# from the repo root:
source <(bash examples/setup.sh)          # 1. wallet + agent key → env
export ANTHROPIC_API_KEY="sk-ant-..."     # 2. your provider key (forwarded)

pip install -r examples/langchain/requirements.txt
python3 examples/langchain/agent.py
```

Expected output:

```
Model (metered through Sanction): <one-sentence recommendation>
Authorize $29 subscribe → approved
Proceed with the purchase — the decision is in your audit feed.
```

Depending on your wallet's default policy the authorize step may come back
`escalated` (approve from the dashboard, or with the `x-mgmt-key` printed by
setup.sh) or `denied` — all three are the product working. The metered call
appears in your dashboard's token usage immediately.

OpenAI via `ChatOpenAI` works the same way — see the
[guide](../../docs/LANGCHAIN.md) for the variant and the escalation/grant flow.
