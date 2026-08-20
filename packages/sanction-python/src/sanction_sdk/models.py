from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

DecisionStatus = Literal["approved", "denied", "escalated", "pending"]

DEFAULT_BASE_URL = "https://getsanction.com/api/v1"


@dataclass(frozen=True, slots=True)
class ToolDecision:
    authorized: bool
    status: DecisionStatus
    request_id: str
    reason: str | None = None
    code: str | None = None
    remediation: str | None = None


@dataclass(frozen=True, slots=True)
class TokenLogResult:
    recorded: bool
    id: str | None = None
    cost_usd: float | None = None
    error: str | None = None
    code: str | None = None
    status: int | None = None
    horizon: str | None = None


@dataclass(frozen=True, slots=True)
class AuthorizationStatus:
    authorized: bool
    status: DecisionStatus
    request_id: str
    reason: str | None = None
    code: str | None = None
    remediation: str | None = None
    grant_id: str | None = None
    grant_status: str | None = None
    grant_consumed_at: str | None = None
    grant_expires_at: str | None = None
