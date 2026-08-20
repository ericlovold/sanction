from __future__ import annotations

import asyncio
from collections.abc import Mapping
from typing import Any

from sanction_sdk.client import AsyncSanctionClient, SanctionClient
from sanction_sdk.models import DEFAULT_BASE_URL, TokenLogResult


def _as_int(value: object) -> int:
    if isinstance(value, bool):
        return 0
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    return 0


def _as_float(value: object) -> float:
    if isinstance(value, bool):
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    return 0.0


def _usage_from(obj: object) -> tuple[int, int]:
    usage: object | None
    if isinstance(obj, Mapping):
        usage = obj.get("usage")
    else:
        usage = getattr(obj, "usage", None)
    if usage is None:
        return 0, 0
    if isinstance(usage, Mapping):
        return _as_int(usage.get("prompt_tokens")), _as_int(usage.get("completion_tokens"))
    prompt = _as_int(getattr(usage, "prompt_tokens", 0))
    completion = _as_int(getattr(usage, "completion_tokens", 0))
    return prompt, completion


def completion_usage(
    kwargs: Mapping[str, Any], response_obj: object
) -> tuple[str, int, int, float]:
    """Pull model / tokens / LiteLLM `response_cost` off a CustomLogger success event."""
    model = kwargs.get("model")
    if not isinstance(model, str) or not model:
        if isinstance(response_obj, Mapping):
            raw_model = response_obj.get("model")
        else:
            raw_model = getattr(response_obj, "model", None)
        model = raw_model if isinstance(raw_model, str) and raw_model else "unknown"

    tokens_in, tokens_out = _usage_from(response_obj)
    if tokens_in == 0 and tokens_out == 0:
        tokens_in, tokens_out = _usage_from(kwargs)

    cost_usd = _as_float(kwargs.get("response_cost"))
    return model, tokens_in, tokens_out, cost_usd


def _task_from(kwargs: Mapping[str, Any], default: str | None) -> str | None:
    params = kwargs.get("litellm_params")
    if isinstance(params, Mapping):
        metadata = params.get("metadata")
        if isinstance(metadata, Mapping):
            task = metadata.get("sanction_task")
            if isinstance(task, str) and task:
                return task
    return default


class SanctionLiteLLMLogger:
    """Duck-typed LiteLLM CustomLogger: posts successful completions to POST /tokens.

    Does not import litellm. Assign with ``litellm.callbacks = [logger]``.

    This is meter/report after the provider call. Fail-closed spend is still
    ``/api/gateway/<provider>`` with ``x-sanction-key``. Callback exceptions never
    propagate into the completion.
    """

    def __init__(
        self,
        client: SanctionClient | AsyncSanctionClient | None = None,
        *,
        api_key: str | None = None,
        base_url: str = DEFAULT_BASE_URL,
        task: str | None = None,
    ) -> None:
        if client is not None:
            self._client: SanctionClient | AsyncSanctionClient = client
        elif api_key:
            self._client = SanctionClient(api_key=api_key, base_url=base_url)
        else:
            raise ValueError("client or api_key is required")
        self._task = task
        self.last_result: TokenLogResult | None = None

    def log_success_event(
        self,
        kwargs: Mapping[str, Any],
        response_obj: object,
        start_time: object,
        end_time: object,
    ) -> None:
        del start_time, end_time
        if isinstance(self._client, AsyncSanctionClient):
            return
        self._report(kwargs, response_obj)

    async def async_log_success_event(
        self,
        kwargs: Mapping[str, Any],
        response_obj: object,
        start_time: object,
        end_time: object,
    ) -> None:
        del start_time, end_time
        await self._areport(kwargs, response_obj)

    def log_failure_event(
        self,
        kwargs: Mapping[str, Any],
        response_obj: object,
        start_time: object,
        end_time: object,
    ) -> None:
        del kwargs, response_obj, start_time, end_time

    async def async_log_failure_event(
        self,
        kwargs: Mapping[str, Any],
        response_obj: object,
        start_time: object,
        end_time: object,
    ) -> None:
        del kwargs, response_obj, start_time, end_time

    def _payload(self, kwargs: Mapping[str, Any], response_obj: object) -> dict[str, Any] | None:
        model, tokens_in, tokens_out, cost_usd = completion_usage(kwargs, response_obj)
        if tokens_in == 0 and tokens_out == 0 and cost_usd == 0.0:
            return None
        body: dict[str, Any] = {
            "model": model,
            "tokens_in": tokens_in,
            "tokens_out": tokens_out,
            "cost_usd": cost_usd,
        }
        task = _task_from(kwargs, self._task)
        if task is not None:
            body["task"] = task
        return body

    def _report(self, kwargs: Mapping[str, Any], response_obj: object) -> None:
        body = self._payload(kwargs, response_obj)
        if body is None or isinstance(self._client, AsyncSanctionClient):
            return
        try:
            self.last_result = self._client.log_tokens(**body)
        except Exception as exc:
            self.last_result = TokenLogResult(
                recorded=False,
                error=str(exc) or "token log failed",
                code="CALLBACK_ERROR",
            )

    async def _areport(self, kwargs: Mapping[str, Any], response_obj: object) -> None:
        body = self._payload(kwargs, response_obj)
        if body is None:
            return
        try:
            if isinstance(self._client, AsyncSanctionClient):
                self.last_result = await self._client.log_tokens(**body)
            else:
                self.last_result = await asyncio.to_thread(self._client.log_tokens, **body)
        except Exception as exc:
            self.last_result = TokenLogResult(
                recorded=False,
                error=str(exc) or "token log failed",
                code="CALLBACK_ERROR",
            )
