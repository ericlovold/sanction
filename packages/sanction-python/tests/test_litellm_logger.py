from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

import httpx
import pytest

from sanction_sdk import AsyncSanctionClient, SanctionClient, SanctionLiteLLMLogger
from sanction_sdk.litellm_logger import completion_usage


def _transport(handler: Any) -> httpx.MockTransport:
    return httpx.MockTransport(handler)


def _recorded_handler(request: httpx.Request) -> httpx.Response:
    return httpx.Response(
        200,
        json={"id": "tok_cb", "recorded": True, "cost_usd": 0.0042},
    )


def test_completion_usage_reads_response_cost_and_usage() -> None:
    response = SimpleNamespace(
        model="gpt-4o-mini",
        usage=SimpleNamespace(prompt_tokens=12, completion_tokens=8),
    )
    model, tokens_in, tokens_out, cost = completion_usage(
        {"model": "gpt-4o-mini", "response_cost": 0.0042},
        response,
    )
    assert model == "gpt-4o-mini"
    assert (tokens_in, tokens_out, cost) == (12, 8, 0.0042)


def test_completion_usage_falls_back_to_dict_usage() -> None:
    model, tokens_in, tokens_out, cost = completion_usage(
        {"usage": {"prompt_tokens": 3, "completion_tokens": 1}},
        {},
    )
    assert model == "unknown"
    assert (tokens_in, tokens_out, cost) == (3, 1, 0.0)


def test_completion_usage_model_from_response_mapping() -> None:
    model, tokens_in, tokens_out, cost = completion_usage(
        {"response_cost": True},
        {"model": "claude-sonnet", "usage": {"prompt_tokens": 1, "completion_tokens": False}},
    )
    assert model == "claude-sonnet"
    assert tokens_in == 1
    assert tokens_out == 0
    assert cost == 0.0


def test_logger_posts_tokens_on_success() -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["json"] = json.loads(request.content.decode())
        return _recorded_handler(request)

    client = SanctionClient(api_key="pxy_test", client=httpx.Client(transport=_transport(handler)))
    logger = SanctionLiteLLMLogger(client, task="nightly")
    logger.log_success_event(
        {"model": "gpt-4o", "response_cost": 0.0042},
        SimpleNamespace(usage=SimpleNamespace(prompt_tokens=10, completion_tokens=20)),
        None,
        None,
    )

    assert logger.last_result is not None
    assert logger.last_result.recorded is True
    assert captured["json"] == {
        "model": "gpt-4o",
        "tokens_in": 10,
        "tokens_out": 20,
        "cost_usd": 0.0042,
        "task": "nightly",
    }


def test_logger_prefers_metadata_task() -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["json"] = json.loads(request.content.decode())
        return _recorded_handler(request)

    client = SanctionClient(api_key="pxy_test", client=httpx.Client(transport=_transport(handler)))
    logger = SanctionLiteLLMLogger(client, task="default")
    logger.log_success_event(
        {
            "model": "gpt-4o",
            "response_cost": 0.01,
            "litellm_params": {"metadata": {"sanction_task": "from-call"}},
        },
        SimpleNamespace(usage=SimpleNamespace(prompt_tokens=1, completion_tokens=1)),
        None,
        None,
    )
    assert captured["json"]["task"] == "from-call"


def test_logger_skips_empty_usage() -> None:
    called = False

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return _recorded_handler(_)

    client = SanctionClient(api_key="pxy_test", client=httpx.Client(transport=_transport(handler)))
    logger = SanctionLiteLLMLogger(client)
    logger.log_success_event({"model": "gpt-4o"}, SimpleNamespace(), None, None)
    assert called is False
    assert logger.last_result is None


def test_logger_swallows_401_so_completion_survives() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "invalid key", "code": "UNAUTHORIZED"})

    client = SanctionClient(api_key="pxy_test", client=httpx.Client(transport=_transport(handler)))
    logger = SanctionLiteLLMLogger(client)
    logger.log_success_event(
        {"model": "gpt-4o", "response_cost": 0.01},
        SimpleNamespace(usage=SimpleNamespace(prompt_tokens=1, completion_tokens=1)),
        None,
        None,
    )
    assert logger.last_result is not None
    assert logger.last_result.recorded is False
    assert logger.last_result.code == "CALLBACK_ERROR"


def test_logger_sync_success_ignores_async_client() -> None:
    client = AsyncSanctionClient(api_key="pxy_test", client=httpx.AsyncClient())
    logger = SanctionLiteLLMLogger(client)
    logger.log_success_event(
        {"model": "gpt-4o", "response_cost": 0.01},
        SimpleNamespace(usage=SimpleNamespace(prompt_tokens=1, completion_tokens=1)),
        None,
        None,
    )
    assert logger.last_result is None


def test_logger_requires_client_or_key() -> None:
    with pytest.raises(ValueError, match="client or api_key"):
        SanctionLiteLLMLogger()


def test_logger_api_key_constructor() -> None:
    logger = SanctionLiteLLMLogger(api_key="pxy_test")
    assert logger.last_result is None
    logger.log_failure_event({}, None, None, None)


@pytest.mark.asyncio
async def test_logger_failure_events_are_noop() -> None:
    logger = SanctionLiteLLMLogger(api_key="pxy_test")
    await logger.async_log_failure_event({}, None, None, None)
    assert logger.last_result is None


@pytest.mark.asyncio
async def test_async_logger_posts_tokens() -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["json"] = json.loads(request.content.decode())
        return _recorded_handler(request)

    client = AsyncSanctionClient(
        api_key="pxy_test",
        client=httpx.AsyncClient(transport=_transport(handler)),
    )
    logger = SanctionLiteLLMLogger(client)
    await logger.async_log_success_event(
        {"model": "claude-sonnet", "response_cost": 0.02},
        {"usage": {"prompt_tokens": 4, "completion_tokens": 6}},
        None,
        None,
    )
    await client.aclose()
    assert logger.last_result is not None
    assert logger.last_result.recorded is True
    assert captured["json"]["tokens_in"] == 4
    assert captured["json"]["tokens_out"] == 6


@pytest.mark.asyncio
async def test_async_logger_with_sync_client() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return _recorded_handler(_)

    client = SanctionClient(api_key="pxy_test", client=httpx.Client(transport=_transport(handler)))
    logger = SanctionLiteLLMLogger(client)
    await logger.async_log_success_event(
        {"model": "gpt-4o", "response_cost": 0.01},
        SimpleNamespace(usage=SimpleNamespace(prompt_tokens=1, completion_tokens=2)),
        None,
        None,
    )
    assert logger.last_result is not None
    assert logger.last_result.recorded is True
