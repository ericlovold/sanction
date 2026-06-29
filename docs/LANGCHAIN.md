# Sanction + LangChain (Python)

> Route LangChain's LLM calls through Sanction's gateway so every token is metered and
> capped, and authorize spend actions before they happen. You keep your own provider key;
> Sanction sits in front of it.

> **Prerequisites:** a Sanction wallet and agent key (`pxy_…`). See the [Quickstart](./quickstart.md).

---

## 1. Install

```bash
pip install langchain-anthropic langchain-openai httpx
```

## 2. Gateway base-URL swap

Point LangChain's provider class at Sanction's gateway and pass your agent key via `default_headers`.

```python
# sanction_llm.py
import os
from langchain_anthropic import ChatAnthropic
from langchain_openai import ChatOpenAI

SANCTION_KEY = os.environ["SANCTION_AGENT_KEY"]  # pxy_...

# Claude via Sanction gateway
llm_claude = ChatAnthropic(
    model="claude-sonnet-4-20250514",
    anthropic_api_url="https://getsanction.com/api/gateway/anthropic",
    default_headers={"x-sanction-key": SANCTION_KEY},
)

# OpenAI via Sanction gateway
llm_openai = ChatOpenAI(
    model="gpt-4o",
    openai_api_base="https://getsanction.com/api/gateway/openai/v1",
    default_headers={"x-sanction-key": SANCTION_KEY},
)
```

Every call through the gateway is automatically metered in your Sanction dashboard.

## 3. Pre-spend authorization

Before your agent performs any financial action, call `POST /api/v1/authorize` and honor the result.

```python
# authorize.py
import os, httpx

SANCTION_API = "https://getsanction.com/api/v1"

def authorize(
    action: str,          # "purchase" | "subscribe" | "transfer"
    amount_usd: float,
    merchant: str,
    category: str,
    description: str = "",
) -> dict:
    """Pre-spend check. Returns a dict with 'status': approved | denied | escalated."""
    resp = httpx.post(
        f"{SANCTION_API}/authorize",
        headers={
            "Content-Type": "application/json",
            "x-api-key": os.environ["SANCTION_AGENT_KEY"],
        },
        json={
            "action": action,
            "amount_usd": amount_usd,
            "merchant": merchant,
            "category": category,
            "description": description,
        },
    )
    resp.raise_for_status()
    return resp.json()
```

## 4. Putting it together

```python
# agent.py
from sanction_llm import llm_claude
from authorize import authorize

def run():
    # 1. LLM call routed through Sanction (auto-metered)
    reply = llm_claude.invoke("Recommend a CI/CD tool under $50/mo")
    print("Recommendation:", reply.content)

    # 2. Pre-spend authorization before acting
    decision = authorize(
        action="subscribe",
        amount_usd=29,
        merchant="GitHub Actions",
        category="software",
        description="CI/CD subscription recommended by agent",
    )

    match decision["status"]:
        case "approved":
            print("Approved -- proceeding with purchase")
        case "escalated":
            print(f"Escalated to human: {decision.get('reason')}")
        case "denied":
            print(f"Denied: {decision.get('reason')}")
            print(f"Remediation: {decision.get('remediation')}")

if __name__ == "__main__":
    run()
```

---

## Environment variables

```bash
export SANCTION_AGENT_KEY=pxy_live_...    # from POST /agents
export ANTHROPIC_API_KEY=sk-ant-...       # your provider key (forwarded through the gateway)
```

## Reference

- [Quickstart](./quickstart.md) · [CrewAI](./crewai.md) · [Vercel AI SDK](./vercel-ai-sdk.md)
- [OpenAPI spec](https://getsanction.com/api/openapi.json)
