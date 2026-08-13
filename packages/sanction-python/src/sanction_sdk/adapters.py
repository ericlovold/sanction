from __future__ import annotations

import inspect
from collections.abc import Awaitable, Callable, Mapping
from functools import wraps
from typing import Any, ParamSpec, TypeVar

from sanction_sdk.client import AsyncSanctionClient, SanctionClient
from sanction_sdk.errors import SanctionToolBlocked
from sanction_sdk.models import ToolDecision

P = ParamSpec("P")
R = TypeVar("R")


def _tool_arguments(
    fn: Callable[..., Any],
    args: tuple[Any, ...],
    kwargs: dict[str, Any],
) -> dict[str, Any]:
    bound = inspect.signature(fn).bind_partial(*args, **kwargs)
    bound.apply_defaults()
    return {"args": list(bound.arguments.values()), "kwargs": dict(kwargs)}


def _ensure_approved(tool: str, decision: ToolDecision) -> None:
    if decision.status == "approved" and decision.authorized:
        return
    raise SanctionToolBlocked(tool, decision)


def sanctioned_tool(
    client: SanctionClient,
    *,
    server: str,
    tool: str,
    idempotency_key: str | None = None,
    grant_id: str | None = None,
) -> Callable[[Callable[P, R]], Callable[P, R]]:
    """Decorator that gates a callable behind Sanction tool authorization."""

    def decorator(fn: Callable[P, R]) -> Callable[P, R]:
        @wraps(fn)
        def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            decision = client.authorize_tool(
                tool=tool,
                server=server,
                arguments=_tool_arguments(fn, args, kwargs),
                idempotency_key=idempotency_key,
                grant_id=grant_id,
            )
            _ensure_approved(tool, decision)
            return fn(*args, **kwargs)

        return wrapper

    return decorator


def async_sanctioned_tool(
    client: AsyncSanctionClient,
    *,
    server: str,
    tool: str,
    idempotency_key: str | None = None,
    grant_id: str | None = None,
) -> Callable[[Callable[P, Awaitable[R]]], Callable[P, Awaitable[R]]]:
    """Async decorator that gates a coroutine behind Sanction tool authorization."""

    def decorator(fn: Callable[P, Awaitable[R]]) -> Callable[P, Awaitable[R]]:
        @wraps(fn)
        async def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            decision = await client.authorize_tool(
                tool=tool,
                server=server,
                arguments=_tool_arguments(fn, args, kwargs),
                idempotency_key=idempotency_key,
                grant_id=grant_id,
            )
            _ensure_approved(tool, decision)
            return await fn(*args, **kwargs)

        return wrapper

    return decorator


class SanctionMiddleware:
    """Framework-neutral hook: authorize before a tool runs, fail closed on deny."""

    def __init__(self, client: SanctionClient | AsyncSanctionClient) -> None:
        self._client = client

    def authorize(
        self,
        *,
        server: str,
        tool: str,
        arguments: Mapping[str, Any] | None = None,
        idempotency_key: str | None = None,
        grant_id: str | None = None,
    ) -> ToolDecision:
        if isinstance(self._client, AsyncSanctionClient):
            raise TypeError("Use authorize_async with AsyncSanctionClient")
        return self._client.authorize_tool(
            tool=tool,
            server=server,
            arguments=arguments,
            idempotency_key=idempotency_key,
            grant_id=grant_id,
        )

    async def authorize_async(
        self,
        *,
        server: str,
        tool: str,
        arguments: Mapping[str, Any] | None = None,
        idempotency_key: str | None = None,
        grant_id: str | None = None,
    ) -> ToolDecision:
        if isinstance(self._client, SanctionClient):
            return self._client.authorize_tool(
                tool=tool,
                server=server,
                arguments=arguments,
                idempotency_key=idempotency_key,
                grant_id=grant_id,
            )
        return await self._client.authorize_tool(
            tool=tool,
            server=server,
            arguments=arguments,
            idempotency_key=idempotency_key,
            grant_id=grant_id,
        )

    def run_if_approved(
        self,
        *,
        server: str,
        tool: str,
        arguments: Mapping[str, Any] | None = None,
        idempotency_key: str | None = None,
        grant_id: str | None = None,
    ) -> ToolDecision:
        decision = self.authorize(
            server=server,
            tool=tool,
            arguments=arguments,
            idempotency_key=idempotency_key,
            grant_id=grant_id,
        )
        _ensure_approved(tool, decision)
        return decision

    async def run_if_approved_async(
        self,
        *,
        server: str,
        tool: str,
        arguments: Mapping[str, Any] | None = None,
        idempotency_key: str | None = None,
        grant_id: str | None = None,
    ) -> ToolDecision:
        decision = await self.authorize_async(
            server=server,
            tool=tool,
            arguments=arguments,
            idempotency_key=idempotency_key,
            grant_id=grant_id,
        )
        _ensure_approved(tool, decision)
        return decision
