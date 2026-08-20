from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from sanction_sdk.errors import SanctionError
from sanction_sdk.models import AuthorizationStatus, DecisionStatus, TokenLogResult, ToolDecision


def fail_closed_denied(reason: str) -> ToolDecision:
    return ToolDecision(
        authorized=False,
        status="denied",
        request_id="",
        code="POLICY_DENIED",
        reason=reason,
    )


def _normalize_status(raw: str) -> DecisionStatus | None:
    if raw == "allowed":
        return "approved"
    if raw in ("approved", "denied", "escalated", "pending"):
        return raw  # type: ignore[return-value]
    return None


def _body_is_decision(body: Mapping[str, Any]) -> bool:
    return isinstance(body.get("status"), str)


def _status_authorized_consistent(status: DecisionStatus, authorized: bool) -> bool:
    if status == "approved":
        return authorized is True
    if status in ("denied", "escalated", "pending"):
        return authorized is False
    return False


def parse_tool_decision(
    *,
    status_code: int,
    body: object | None,
    unreachable_reason: str | None = None,
) -> ToolDecision:
    if unreachable_reason is not None:
        return fail_closed_denied(unreachable_reason)

    if not isinstance(body, dict):
        if status_code >= 500 or (200 <= status_code < 300):
            return fail_closed_denied(
                f"Sanction error ({status_code}); tool gate failing closed"
                if status_code >= 500
                else "Malformed tool decision payload"
            )
        raise SanctionError(
            f"Tool authorization failed ({status_code})",
            status=status_code,
            body=body,
        )

    if not _body_is_decision(body):
        if status_code >= 500:
            return fail_closed_denied(
                f"Sanction error ({status_code}); tool gate failing closed"
            )
        raise SanctionError(
            str(body.get("error") or f"Tool authorization failed ({status_code})"),
            status=status_code,
            code=body.get("code") if isinstance(body.get("code"), str) else None,
            body=body,
        )

    raw_status = str(body["status"])
    status = _normalize_status(raw_status)
    if status is None:
        return fail_closed_denied("Malformed tool decision status")

    authorized = bool(body.get("authorized"))
    if not _status_authorized_consistent(status, authorized):
        return fail_closed_denied("Contradictory tool decision payload")

    return ToolDecision(
        authorized=authorized,
        status=status,
        request_id=str(body.get("request_id") or ""),
        reason=body.get("reason") if isinstance(body.get("reason"), str) else None,
        code=body.get("code") if isinstance(body.get("code"), str) else None,
        remediation=(
            body.get("remediation") if isinstance(body.get("remediation"), str) else None
        ),
    )


def parse_token_log(
    *,
    status_code: int,
    body: object | None,
    unreachable_reason: str | None = None,
) -> TokenLogResult:
    if unreachable_reason is not None:
        return TokenLogResult(
            recorded=False,
            error=unreachable_reason,
            code="UNREACHABLE",
            status=0,
        )

    payload = body if isinstance(body, dict) else None
    error_message = "Token log failed"
    code: str | None = None
    horizon: str | None = None
    if payload is not None:
        if isinstance(payload.get("error"), str):
            error_message = payload["error"]
        if isinstance(payload.get("code"), str):
            code = payload["code"]
        if isinstance(payload.get("horizon"), str):
            horizon = payload["horizon"]

    if status_code == 402:
        return TokenLogResult(
            recorded=False,
            error=error_message,
            code=code or "BUDGET_EXCEEDED",
            status=402,
            horizon=horizon,
        )

    if 400 <= status_code < 500:
        raise SanctionError(error_message, status=status_code, code=code, body=body)

    if 200 <= status_code < 300 and payload is not None and payload.get("recorded") is True:
        cost = payload.get("cost_usd")
        return TokenLogResult(
            recorded=True,
            id=str(payload.get("id") or ""),
            cost_usd=float(cost) if isinstance(cost, (int, float)) else None,
            status=status_code,
        )

    return TokenLogResult(
        recorded=False,
        error=(
            f"Sanction error ({status_code}); token log not recorded"
            if status_code >= 500
            else "Malformed token log payload"
        ),
        code="UNREACHABLE" if status_code >= 500 else "MALFORMED",
        status=status_code,
    )


def parse_authorization_status(body: Mapping[str, Any], request_id: str) -> AuthorizationStatus:
    raw_status = str(body.get("status") or "pending")
    status = _normalize_status(raw_status) or "pending"
    return AuthorizationStatus(
        authorized=bool(body.get("authorized")),
        status=status,
        request_id=str(body.get("request_id") or request_id),
        reason=body.get("reason") if isinstance(body.get("reason"), str) else None,
        code=body.get("code") if isinstance(body.get("code"), str) else None,
        remediation=(
            body.get("remediation") if isinstance(body.get("remediation"), str) else None
        ),
        grant_id=body.get("grant_id") if isinstance(body.get("grant_id"), str) else None,
        grant_status=(
            body.get("grant_status") if isinstance(body.get("grant_status"), str) else None
        ),
        grant_consumed_at=(
            body.get("grant_consumed_at")
            if isinstance(body.get("grant_consumed_at"), str)
            else None
        ),
        grant_expires_at=(
            body.get("grant_expires_at")
            if isinstance(body.get("grant_expires_at"), str)
            else None
        ),
    )
