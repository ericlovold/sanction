from __future__ import annotations

import pytest

from sanction_sdk._parse import parse_authorization_status, parse_token_log, parse_tool_decision
from sanction_sdk.errors import SanctionError


def test_parse_tool_decision_malformed_status() -> None:
    decision = parse_tool_decision(
        status_code=200,
        body={"authorized": True, "status": "maybe", "request_id": "x"},
    )
    assert decision.status == "denied"
    assert decision.code == "POLICY_DENIED"


def test_parse_tool_decision_invalid_json_body_on_4xx_raises() -> None:
    with pytest.raises(SanctionError) as exc:
        parse_tool_decision(status_code=400, body=None)
    assert exc.value.status == 400


def test_parse_tool_decision_5xx_without_body_fails_closed() -> None:
    decision = parse_tool_decision(status_code=502, body=None)
    assert decision.status == "denied"
    assert "502" in (decision.reason or "")


def test_parse_tool_decision_pending_requires_unauthorized() -> None:
    decision = parse_tool_decision(
        status_code=200,
        body={"authorized": False, "status": "pending", "request_id": "req_p"},
    )
    assert decision.status == "pending"
    assert decision.authorized is False


def test_parse_tool_decision_non_decision_5xx_fails_closed() -> None:
    decision = parse_tool_decision(
        status_code=500,
        body={"error": "boom"},
    )
    assert decision.status == "denied"


def test_parse_authorization_status_normalizes_allowed() -> None:
    status = parse_authorization_status(
        {"authorized": True, "status": "allowed", "request_id": "req_1"},
        "fallback",
    )
    assert status.status == "approved"
    assert status.request_id == "req_1"


def test_parse_token_log_recorded() -> None:
    result = parse_token_log(
        status_code=200,
        body={"id": "tok_1", "recorded": True, "cost_usd": 0.2},
    )
    assert result.recorded is True
    assert result.id == "tok_1"
    assert result.cost_usd == 0.2


def test_parse_token_log_400_raises() -> None:
    with pytest.raises(SanctionError) as exc:
        parse_token_log(status_code=400, body={"error": "Invalid request"})
    assert exc.value.status == 400


def test_parse_token_log_non_json_5xx() -> None:
    result = parse_token_log(status_code=502, body=None)
    assert result.recorded is False
    assert result.code == "UNREACHABLE"
