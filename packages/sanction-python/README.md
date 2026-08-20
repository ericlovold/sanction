# Sanction Python SDK

Publishable Python client for Sanction agent integrations — tool authorization,
escalation polling, token metering, and a LiteLLM callback.

**Status:** internal / unpublished (`0.1.0`). Not on PyPI yet.

## Install (local)

```bash
cd packages/sanction-python
uv sync --frozen --all-groups
```

## Quick start

```python
import os
from sanction_sdk import SanctionClient

client = SanctionClient(api_key=os.environ["SANCTION_AGENT_KEY"])

decision = client.authorize_tool(
    tool="github.create_pr",
    server="github",
    arguments={"title": "Quarterly update"},
)

if decision.status == "approved":
    # run the tool
    ...
elif decision.status == "escalated":
    status = client.get_authorization(decision.request_id)
    # poll until approved, then retry with status.grant_id
    ...
else:
    # denied — branch and replan
    ...
```

## LiteLLM

Post-call meter. Fail-closed spend is still the LLM gateway.

```python
import os
import litellm
from sanction_sdk import SanctionLiteLLMLogger

litellm.callbacks = [
    SanctionLiteLLMLogger(api_key=os.environ["SANCTION_AGENT_KEY"])
]
```

## Adapters

```python
from sanction_sdk import SanctionClient, sanctioned_tool

client = SanctionClient(api_key="...")

@sanctioned_tool(client, server="github", tool="github.create_pr")
def create_pr(title: str) -> str:
    ...
```

See `docs/FRAMEWORK-ADAPTERS.md` in the Sanction repo for LangChain/LangGraph
copy-in recipes.

## Wire contract

- Tool authorize body uses **`arguments`** (not `input`).
- Idempotency: `idempotency-key` header on retried calls.
- Tool gate **fails closed** when Sanction is unreachable or returns malformed 5xx bodies.
- `log_tokens` is meter/report after the call; a 402 does not unspend the provider.

## Verify

```bash
uv sync --frozen --all-groups
uv run pytest --cov=sanction_sdk --cov-fail-under=90
uv run mypy src tests
uv run ruff check src tests
uv build
```

## License

FSL-1.1-MIT — see `LICENSE`.
