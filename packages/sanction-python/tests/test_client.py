from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from sanction_sdk import AsyncSanctionClient, SanctionClient
from sanction_sdk.errors import SanctionError


def _transport(handler: Any) -> httpx.MockTransport:
    return httpx.MockTransport(handler)


def test_authorize_tool_maps_arguments_wire_field() -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["json"] = json.loads(request.content.decode())
        captured["headers"] = dict(request.headers)
        return httpx.Response(
            200,
            json={
                "authorized": True,
                "status": "allowed",
                "request_id": "req_1",
            },
        )

    client = SanctionClient(api_key="sk_test", client=httpx.Client(transport=_transport(handler)))
    decision = client.authorize_tool(
        tool="github.create_pr",
        server="github",
        arguments={"title": "x"},
        idempotency_key="idem-1",
    )

    assert decision.authorized is True
    assert decision.status == "approved"
    assert captured["json"] == {
        "tool": "github.create_pr",
        "server": "github",
        "arguments": {"title": "x"},
    }
    assert captured["headers"]["idempotency-key"] == "idem-1"


def test_authorize_tool_fails_closed_on_network_error() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    client = SanctionClient(api_key="sk_test", client=httpx.Client(transport=_transport(handler)))
    decision = client.authorize_tool(tool="shell.exec")

    assert decision.authorized is False
    assert decision.status == "denied"
    assert decision.code == "POLICY_DENIED"
    assert "unreachable" in (decision.reason or "").lower()


def test_authorize_tool_fails_closed_on_5xx_without_decision() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(503, json={"error": "upstream"})

    client = SanctionClient(api_key="sk_test", client=httpx.Client(transport=_transport(handler)))
    decision = client.authorize_tool(tool="shell.exec")

    assert decision.status == "denied"
    assert decision.code == "POLICY_DENIED"


def test_authorize_tool_raises_on_401_without_decision() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "invalid key", "code": "UNAUTHORIZED"})

    client = SanctionClient(api_key="sk_test", client=httpx.Client(transport=_transport(handler)))

    with pytest.raises(SanctionError) as exc:
        client.authorize_tool(tool="shell.exec")

    assert exc.value.status == 401
    assert exc.value.code == "UNAUTHORIZED"


def test_authorize_tool_fails_closed_on_contradictory_payload() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"authorized": True, "status": "denied", "request_id": "req_bad"},
        )

    client = SanctionClient(api_key="sk_test", client=httpx.Client(transport=_transport(handler)))
    decision = client.authorize_tool(tool="shell.exec")

    assert decision.status == "denied"
    assert decision.code == "POLICY_DENIED"
    assert "contradictory" in (decision.reason or "").lower()


def test_get_authorization_maps_grant_fields() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/authorize/req_esc")
        return httpx.Response(
            200,
            json={
                "authorized": True,
                "status": "approved",
                "request_id": "req_esc",
                "grant_id": "grant_9",
                "grant_status": "issued",
                "grant_expires_at": "2026-07-12T12:00:00Z",
            },
        )

    client = SanctionClient(api_key="sk_test", client=httpx.Client(transport=_transport(handler)))
    status = client.get_authorization("req_esc")

    assert status.grant_id == "grant_9"
    assert status.grant_status == "issued"
    assert status.grant_expires_at == "2026-07-12T12:00:00Z"


@pytest.mark.asyncio
async def test_async_authorize_tool_normalizes_allowed_status() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"authorized": True, "status": "allowed", "request_id": "req_a"},
        )

    client = AsyncSanctionClient(
        api_key="sk_test",
        client=httpx.AsyncClient(transport=_transport(handler)),
    )
    decision = await client.authorize_tool(tool="web.search")
    await client.aclose()

    assert decision.status == "approved"


def test_client_requires_api_key() -> None:
    with pytest.raises(ValueError, match="api_key"):
        SanctionClient(api_key="")


def test_sync_client_context_manager_closes() -> None:
    closed = False

    class TrackingClient(httpx.Client):
        def close(self) -> None:
            nonlocal closed
            closed = True
            super().close()

    with SanctionClient(api_key="sk_test", client=TrackingClient()) as client:
        assert client is not None
    assert closed is True


def test_authorize_tool_includes_grant_id() -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["json"] = json.loads(request.content.decode())
        return httpx.Response(
            200,
            json={"authorized": True, "status": "allowed", "request_id": "req_g"},
        )

    client = SanctionClient(api_key="sk_test", client=httpx.Client(transport=_transport(handler)))
    client.authorize_tool(tool="deploy.prod", grant_id="grant_42")
    assert captured["json"]["grant_id"] == "grant_42"


def test_authorize_tool_fails_closed_on_invalid_json_body() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"not-json")

    client = SanctionClient(api_key="sk_test", client=httpx.Client(transport=_transport(handler)))
    decision = client.authorize_tool(tool="shell.exec")
    assert decision.status == "denied"


def test_get_authorization_requires_request_id() -> None:
    client = SanctionClient(api_key="sk_test", client=httpx.Client())
    with pytest.raises(ValueError, match="request_id"):
        client.get_authorization("")


def test_get_authorization_raises_on_lookup_error() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"error": "not found", "code": "NOT_FOUND"})

    client = SanctionClient(api_key="sk_test", client=httpx.Client(transport=_transport(handler)))
    with pytest.raises(SanctionError) as exc:
        client.get_authorization("req_missing")
    assert exc.value.status == 404
    assert exc.value.code == "NOT_FOUND"


def test_get_authorization_raises_on_lookup_error_with_non_json_body() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(500, content=b"broken")

    client = SanctionClient(api_key="sk_test", client=httpx.Client(transport=_transport(handler)))
    with pytest.raises(SanctionError):
        client.get_authorization("req_missing")


def test_get_authorization_raises_on_malformed_body() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=["not", "a", "dict"])

    client = SanctionClient(api_key="sk_test", client=httpx.Client(transport=_transport(handler)))
    with pytest.raises(SanctionError, match="Malformed"):
        client.get_authorization("req_bad")


@pytest.mark.asyncio
async def test_async_client_context_manager_and_network_fail_closed() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("timeout")

    async with AsyncSanctionClient(
        api_key="sk_test",
        client=httpx.AsyncClient(transport=_transport(handler)),
    ) as client:
        decision = await client.authorize_tool(tool="shell.exec")
    assert decision.status == "denied"


@pytest.mark.asyncio
async def test_async_get_authorization_success_and_errors() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/authorize/req_ok"):
            return httpx.Response(
                200,
                json={"authorized": False, "status": "escalated", "request_id": "req_ok"},
            )
        return httpx.Response(500, content=b"broken")

    client = AsyncSanctionClient(
        api_key="sk_test",
        client=httpx.AsyncClient(transport=_transport(handler)),
    )
    status = await client.get_authorization("req_ok")
    assert status.status == "escalated"

    with pytest.raises(SanctionError):
        await client.get_authorization("req_err")
    await client.aclose()


@pytest.mark.asyncio
async def test_async_get_authorization_malformed_success_body() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json="bad")

    client = AsyncSanctionClient(
        api_key="sk_test",
        client=httpx.AsyncClient(transport=_transport(handler)),
    )
    with pytest.raises(SanctionError, match="Malformed"):
        await client.get_authorization("req_bad")
    await client.aclose()


@pytest.mark.asyncio
async def test_async_get_authorization_requires_request_id() -> None:
    client = AsyncSanctionClient(api_key="sk_test", client=httpx.AsyncClient())
    with pytest.raises(ValueError, match="request_id"):
        await client.get_authorization("")
    await client.aclose()


@pytest.mark.asyncio
async def test_async_client_requires_api_key() -> None:
    with pytest.raises(ValueError, match="api_key"):
        AsyncSanctionClient(api_key="")
