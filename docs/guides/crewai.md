# Sanction + CrewAI (Python) Integration

Route CrewAI agent LLM calls through Sanction's gateway and authorize spend actions before they happen.

> **Prerequisites:** A Sanction wallet and agent key (`pxy_...`). See the [Quickstart](./quickstart.md).

---

## 1. Install Dependencies

```bash
pip install crewai httpx
```

## 2. Gateway Base-URL Swap

CrewAI uses LiteLLM under the hood. Point it at Sanction's gateway with extra headers.

```python
# sanction_crew.py
import os
from crewai import LLM

SANCTION_KEY = os.environ["SANCTION_AGENT_KEY"]  # pxy_...

# Claude via Sanction gateway
llm = LLM(
    model="anthropic/claude-sonnet-4-20250514",
    api_base="https://getsanction.com/api/gateway/anthropic",
    extra_headers={"x-sanction-key": SANCTION_KEY},
)

# OpenAI via Sanction gateway
llm_openai = LLM(
    model="openai/gpt-4o",
    api_base="https://getsanction.com/api/gateway/openai/v1",
    extra_headers={"x-sanction-key": SANCTION_KEY},
)
```

Every call through the gateway is automatically metered in your Sanction dashboard.

## 3. Pre-Spend Authorization Callback

```python
# authorize.py
import os, httpx

SANCTION_API = "https://getsanction.com/api/v1"

def authorize(
    action: str,
    amount_usd: float,
    merchant: str,
    category: str,
    description: str = "",
) -> dict:
    """Pre-spend check. Returns dict with 'status': approved|denied|escalated."""
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

## 4. Putting It Together

```python
# crew_agent.py
from crewai import Agent, Task, Crew
from crewai.tools import tool
from sanction_crew import llm
from authorize import authorize

@tool("authorize_spend")
def authorize_spend(action: str, amount_usd: float, merchant: str, category: str, description: str = "") -> str:
    """Check Sanction policy before any financial action."""
    decision = authorize(action, amount_usd, merchant, category, description)
    status = decision["status"]
    if status == "approved":
        return f"APPROVED: proceed with {action} of ${amount_usd} at {merchant}"
    elif status == "escalated":
        return f"ESCALATED: waiting for human approval -- {decision.get('reason', '')}"
    else:
        return f"DENIED: {decision.get('reason', '')} | {decision.get('remediation', '')}"

researcher = Agent(
    role="Procurement Researcher",
    goal="Find and recommend software tools within budget",
    backstory="You evaluate SaaS tools and check spend approval before purchasing.",
    tools=[authorize_spend],
    llm=llm,
)

task = Task(
    description="Find a CI/CD tool under $50/mo. Authorize the purchase via Sanction before proceeding.",
    expected_output="Tool recommendation with Sanction approval status",
    agent=researcher,
)

crew = Crew(agents=[researcher], tasks=[task], verbose=True)

if __name__ == "__main__":
    result = crew.kickoff()
    print(result)
```

---

## Environment Variables

```bash
export SANCTION_AGENT_KEY=pxy_live_...
export ANTHROPIC_API_KEY=sk-ant-...
```

## Reference

- [OpenAPI spec](https://getsanction.com/api/openapi.json)
- [Quickstart](./quickstart.md)
