from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import httpx

from sanction_sdk._parse import parse_authorization_status, parse_token_log, parse_tool_decision
from sanction_sdk.errors import SanctionError
from sanction_sdk.models import DEFAULT_BASE_URL, AuthorizationStatus, TokenLogResult, ToolDecision


class SanctionClient:
    """Synchronous Sanction agent SDK — tool authorization and escalation polling."""

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str = DEFAULT_BASE_URL,
        timeout_s: float = 10.0,
        client: httpx.Client | None = None,
    ) -> None:
        if not api_key:
            raise ValueError("api_key is required")
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._timeout_s = timeout_s
        self._client = client or httpx.Client(timeout=timeout_s)

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> SanctionClient:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def _headers(self, *, idempotency_key: str | None = None) -> dict[str, str]:
        headers = {"x-api-key": self._api_key}
        if idempotency_key:
            headers["idempotency-key"] = idempotency_key
        return headers

    def authorize_tool(
        self,
        *,
        tool: str,
        server: str | None = None,
        arguments: Mapping[str, Any] | None = None,
        grant_id: str | None = None,
        idempotency_key: str | None = None,
    ) -> ToolDecision:
        body: dict[str, Any] = {
            "tool": tool,
            "arguments": dict(arguments or {}),
        }
        if server is not None:
            body["server"] = server
        if grant_id is not None:
            body["grant_id"] = grant_id

        try:
            response = self._client.post(
                f"{self._base_url}/authorize/tool",
                headers=self._headers(idempotency_key=idempotency_key),
                json=body,
            )
        except httpx.RequestError:
            return parse_tool_decision(
                status_code=0,
                body=None,
                unreachable_reason="Sanction unreachable; tool gate failing closed",
            )

        payload: object | None
        try:
            payload = response.json()
        except ValueError:
            payload = None

        return parse_tool_decision(status_code=response.status_code, body=payload)

    def get_authorization(self, request_id: str) -> AuthorizationStatus:
        if not request_id:
            raise ValueError("request_id is required")

        response = self._client.get(
            f"{self._base_url}/authorize/{request_id}",
            headers=self._headers(),
        )
        if response.status_code >= 400:
            body: object | None
            try:
                body = response.json()
            except ValueError:
                body = None
            message = "Authorization lookup failed"
            code: str | None = None
            if isinstance(body, dict):
                if isinstance(body.get("error"), str):
                    message = body["error"]
                if isinstance(body.get("code"), str):
                    code = body["code"]
            raise SanctionError(message, status=response.status_code, code=code, body=body)

        data = response.json()
        if not isinstance(data, dict):
            raise SanctionError(
                "Malformed authorization status",
                status=response.status_code,
                body=data,
            )
        return parse_authorization_status(data, request_id)

    def log_tokens(
        self,
        *,
        model: str,
        tokens_in: int,
        tokens_out: int,
        cost_usd: float,
        task: str | None = None,
    ) -> TokenLogResult:
        body: dict[str, Any] = {
            "model": model,
            "tokens_in": tokens_in,
            "tokens_out": tokens_out,
            "cost_usd": cost_usd,
        }
        if task is not None:
            body["task"] = task

        try:
            response = self._client.post(
                f"{self._base_url}/tokens",
                headers=self._headers(),
                json=body,
            )
        except httpx.RequestError:
            return parse_token_log(
                status_code=0,
                body=None,
                unreachable_reason="Sanction unreachable; token log not recorded",
            )

        payload: object | None
        try:
            payload = response.json()
        except ValueError:
            payload = None

        return parse_token_log(status_code=response.status_code, body=payload)


class AsyncSanctionClient:
    """Async Sanction agent SDK — same semantics as SanctionClient."""

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str = DEFAULT_BASE_URL,
        timeout_s: float = 10.0,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        if not api_key:
            raise ValueError("api_key is required")
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._timeout_s = timeout_s
        self._client = client or httpx.AsyncClient(timeout=timeout_s)

    async def aclose(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> AsyncSanctionClient:
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.aclose()

    def _headers(self, *, idempotency_key: str | None = None) -> dict[str, str]:
        headers = {"x-api-key": self._api_key}
        if idempotency_key:
            headers["idempotency-key"] = idempotency_key
        return headers

    async def authorize_tool(
        self,
        *,
        tool: str,
        server: str | None = None,
        arguments: Mapping[str, Any] | None = None,
        grant_id: str | None = None,
        idempotency_key: str | None = None,
    ) -> ToolDecision:
        body: dict[str, Any] = {
            "tool": tool,
            "arguments": dict(arguments or {}),
        }
        if server is not None:
            body["server"] = server
        if grant_id is not None:
            body["grant_id"] = grant_id

        try:
            response = await self._client.post(
                f"{self._base_url}/authorize/tool",
                headers=self._headers(idempotency_key=idempotency_key),
                json=body,
            )
        except httpx.RequestError:
            return parse_tool_decision(
                status_code=0,
                body=None,
                unreachable_reason="Sanction unreachable; tool gate failing closed",
            )

        payload: object | None
        try:
            payload = response.json()
        except ValueError:
            payload = None

        return parse_tool_decision(status_code=response.status_code, body=payload)

    async def get_authorization(self, request_id: str) -> AuthorizationStatus:
        if not request_id:
            raise ValueError("request_id is required")

        response = await self._client.get(
            f"{self._base_url}/authorize/{request_id}",
            headers=self._headers(),
        )
        if response.status_code >= 400:
            body: object | None
            try:
                body = response.json()
            except ValueError:
                body = None
            message = "Authorization lookup failed"
            code: str | None = None
            if isinstance(body, dict):
                if isinstance(body.get("error"), str):
                    message = body["error"]
                if isinstance(body.get("code"), str):
                    code = body["code"]
            raise SanctionError(message, status=response.status_code, code=code, body=body)

        data = response.json()
        if not isinstance(data, dict):
            raise SanctionError(
                "Malformed authorization status",
                status=response.status_code,
                body=data,
            )
        return parse_authorization_status(data, request_id)

    async def log_tokens(
        self,
        *,
        model: str,
        tokens_in: int,
        tokens_out: int,
        cost_usd: float,
        task: str | None = None,
    ) -> TokenLogResult:
        body: dict[str, Any] = {
            "model": model,
            "tokens_in": tokens_in,
            "tokens_out": tokens_out,
            "cost_usd": cost_usd,
        }
        if task is not None:
            body["task"] = task

        try:
            response = await self._client.post(
                f"{self._base_url}/tokens",
                headers=self._headers(),
                json=body,
            )
        except httpx.RequestError:
            return parse_token_log(
                status_code=0,
                body=None,
                unreachable_reason="Sanction unreachable; token log not recorded",
            )

        payload: object | None
        try:
            payload = response.json()
        except ValueError:
            payload = None

        return parse_token_log(status_code=response.status_code, body=payload)
