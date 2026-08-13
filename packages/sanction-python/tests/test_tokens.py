from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from sanction_sdk import AsyncSanctionClient, SanctionClient
from sanction_sdk.errors import SanctionError


def _transport(handler: Any) -> httpx.MockTransport:
    return httpx.MockTransport(handler)


def test_log_tokens_posts_wire_body() -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["json"] = json.loads(request.content.decode())
        captured["path"] = request.url.path
        captured["headers"] = dict(request.headers)
        return httpx.Response(
            200,
            json={"id": "tok_1", "recorded": True, "cost_usd": 0.012, "agent": "demo"},
        )

    client = SanctionClient(api_key="pxy_test", client=httpx.Client(transport=_transport(handler)))
    result = client.log_tokens(
        model="gpt-4o",
        tokens_in=10,
        tokens_out=20,
        cost_usd=0.012,
        task="summarize",
    )

    assert result.recorded is True
    assert result.id == "tok_1"
    assert result.cost_usd == 0.012
    assert captured["path"].endswith("/tokens")
    assert captured["json"] == {
        "model": "gpt-4o",
        "tokens_in": 10,
        "tokens_out": 20,
        "cost_usd": 0.012,
        "task": "summarize",
    }
    assert captured["headers"]["x-api-key"] == "pxy_test"


def test_log_tokens_402_is_not_recorded() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            402,
            json={
                "error": "Daily token budget exceeded",
                "horizon": "daily",
                "limit_usd": 1.0,
                "spent_usd": 0.99,
            },
        )

    client = SanctionClient(api_key="pxy_test", client=httpx.Client(transport=_transport(handler)))
    result = client.log_tokens(model="gpt-4o", tokens_in=1, tokens_out=1, cost_usd=0.5)

    assert result.recorded is False
    assert result.status == 402
    assert result.code == "BUDGET_EXCEEDED"
    assert result.horizon == "daily"


def test_log_tokens_unreachable_is_not_recorded() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    client = SanctionClient(api_key="pxy_test", client=httpx.Client(transport=_transport(handler)))
    result = client.log_tokens(model="gpt-4o", tokens_in=1, tokens_out=1, cost_usd=0.01)

    assert result.recorded is False
    assert result.code == "UNREACHABLE"


def test_log_tokens_5xx_is_not_recorded() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(503, json={"error": "upstream"})

    client = SanctionClient(api_key="pxy_test", client=httpx.Client(transport=_transport(handler)))
    result = client.log_tokens(model="gpt-4o", tokens_in=1, tokens_out=1, cost_usd=0.01)

    assert result.recorded is False
    assert result.status == 503
    assert result.code == "UNREACHABLE"


def test_log_tokens_401_raises() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "invalid key", "code": "UNAUTHORIZED"})

    client = SanctionClient(api_key="pxy_test", client=httpx.Client(transport=_transport(handler)))
    with pytest.raises(SanctionError) as exc:
        client.log_tokens(model="gpt-4o", tokens_in=1, tokens_out=1, cost_usd=0.01)
    assert exc.value.status == 401
    assert exc.value.code == "UNAUTHORIZED"


def test_log_tokens_malformed_200() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"ok": True})

    client = SanctionClient(api_key="pxy_test", client=httpx.Client(transport=_transport(handler)))
    result = client.log_tokens(model="gpt-4o", tokens_in=1, tokens_out=1, cost_usd=0.01)
    assert result.recorded is False
    assert result.code == "MALFORMED"


def test_log_tokens_invalid_json_body() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"not-json")

    client = SanctionClient(api_key="pxy_test", client=httpx.Client(transport=_transport(handler)))
    result = client.log_tokens(model="gpt-4o", tokens_in=1, tokens_out=1, cost_usd=0.01)
    assert result.recorded is False
    assert result.code == "MALFORMED"


@pytest.mark.asyncio
async def test_async_log_tokens_records() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"id": "tok_a", "recorded": True, "cost_usd": 0.1})

    client = AsyncSanctionClient(
        api_key="pxy_test",
        client=httpx.AsyncClient(transport=_transport(handler)),
    )
    result = await client.log_tokens(model="claude-sonnet", tokens_in=2, tokens_out=3, cost_usd=0.1)
    await client.aclose()
    assert result.recorded is True
    assert result.id == "tok_a"


@pytest.mark.asyncio
async def test_async_log_tokens_unreachable() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    client = AsyncSanctionClient(
        api_key="pxy_test",
        client=httpx.AsyncClient(transport=_transport(handler)),
    )
    result = await client.log_tokens(model="gpt-4o", tokens_in=1, tokens_out=1, cost_usd=0.01)
    await client.aclose()
    assert result.recorded is False
    assert result.code == "UNREACHABLE"
