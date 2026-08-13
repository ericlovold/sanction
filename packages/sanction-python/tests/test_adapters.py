from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from sanction_sdk import SanctionClient
from sanction_sdk.adapters import SanctionMiddleware, async_sanctioned_tool, sanctioned_tool
from sanction_sdk.client import AsyncSanctionClient
from sanction_sdk.errors import SanctionToolBlocked


def _transport(handler: Any) -> httpx.MockTransport:
    return httpx.MockTransport(handler)


def _approved_handler(_: httpx.Request) -> httpx.Response:
    return httpx.Response(
        200,
        json={"authorized": True, "status": "allowed", "request_id": "req_ok"},
    )


def test_sanctioned_tool_runs_on_approved() -> None:
    client = SanctionClient(
        api_key="sk_test",
        client=httpx.Client(transport=_transport(_approved_handler)),
    )

    @sanctioned_tool(client, server="github", tool="github.create_pr")
    def create_pr(title: str) -> str:
        return f"created:{title}"

    assert create_pr("demo") == "created:demo"


def test_sanctioned_tool_blocks_denied() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            403,
            json={
                "authorized": False,
                "status": "denied",
                "request_id": "req_deny",
                "code": "TOOL_BLOCKED",
                "reason": "blocked by policy",
            },
        )

    client = SanctionClient(api_key="sk_test", client=httpx.Client(transport=_transport(handler)))

    @sanctioned_tool(client, server="shell", tool="shell.exec")
    def run_cmd(cmd: str) -> str:
        return cmd

    with pytest.raises(SanctionToolBlocked) as exc:
        run_cmd("rm -rf /")

    assert exc.value.decision.code == "TOOL_BLOCKED"


def test_sanctioned_tool_surfaces_escalation() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            202,
            json={
                "authorized": False,
                "status": "escalated",
                "request_id": "req_esc",
            },
        )

    client = SanctionClient(api_key="sk_test", client=httpx.Client(transport=_transport(handler)))

    @sanctioned_tool(client, server="deploy", tool="deploy.prod")
    def deploy() -> None:
        return None

    with pytest.raises(SanctionToolBlocked, match="escalation"):
        deploy()


def test_middleware_sends_arguments_not_input() -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["json"] = json.loads(request.content.decode())
        return _approved_handler(request)

    client = SanctionClient(api_key="sk_test", client=httpx.Client(transport=_transport(handler)))
    middleware = SanctionMiddleware(client)
    middleware.run_if_approved(
        server="mia",
        tool="ethics.analyse",
        arguments={"schema": "mia.advisory-context.v1", "authority": "advisory-only"},
    )

    assert "arguments" in captured["json"]
    assert "input" not in captured["json"]


def test_middleware_authorize_returns_decision_without_running() -> None:
    client = SanctionClient(
        api_key="sk_test",
        client=httpx.Client(transport=_transport(_approved_handler)),
    )
    middleware = SanctionMiddleware(client)
    decision = middleware.authorize(server="github", tool="github.create_pr")
    assert decision.status == "approved"


def test_middleware_sync_authorize_rejects_async_client() -> None:
    client = AsyncSanctionClient(
        api_key="sk_test",
        client=httpx.AsyncClient(transport=_transport(_approved_handler)),
    )
    middleware = SanctionMiddleware(client)
    with pytest.raises(TypeError, match="authorize_async"):
        middleware.authorize(server="github", tool="github.create_pr")


@pytest.mark.asyncio
async def test_middleware_async_paths() -> None:
    def denied_handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            403,
            json={"authorized": False, "status": "denied", "request_id": "req_d"},
        )

    sync_client = SanctionClient(
        api_key="sk_test",
        client=httpx.Client(transport=_transport(_approved_handler)),
    )
    sync_middleware = SanctionMiddleware(sync_client)
    decision = await sync_middleware.authorize_async(server="github", tool="github.create_pr")
    assert decision.status == "approved"

    async_client = AsyncSanctionClient(
        api_key="sk_test",
        client=httpx.AsyncClient(transport=_transport(denied_handler)),
    )
    async_middleware = SanctionMiddleware(async_client)
    with pytest.raises(SanctionToolBlocked):
        await async_middleware.run_if_approved_async(server="shell", tool="shell.exec")

    async_client2 = AsyncSanctionClient(
        api_key="sk_test",
        client=httpx.AsyncClient(transport=_transport(_approved_handler)),
    )
    async_middleware2 = SanctionMiddleware(async_client2)
    approved = await async_middleware2.run_if_approved_async(
        server="github",
        tool="github.create_pr",
    )
    assert approved.status == "approved"
    await async_client.aclose()
    await async_client2.aclose()


@pytest.mark.asyncio
async def test_async_sanctioned_tool_runs_on_approved() -> None:
    client = AsyncSanctionClient(
        api_key="sk_test",
        client=httpx.AsyncClient(transport=_transport(_approved_handler)),
    )

    @async_sanctioned_tool(client, server="github", tool="github.create_pr")
    async def create_pr(title: str) -> str:
        return f"async:{title}"

    assert await create_pr("x") == "async:x"
    await client.aclose()
