from __future__ import annotations

from sanction_sdk.models import ToolDecision


class SanctionError(Exception):
    """Raised when the API returns a caller or auth error without a decision body."""

    def __init__(
        self,
        message: str,
        *,
        status: int,
        code: str | None = None,
        body: object | None = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.body = body


class SanctionToolBlocked(SanctionError):
    """Raised when a tool call is not approved before execution."""

    def __init__(self, tool: str, decision: ToolDecision) -> None:
        if decision.status == "escalated":
            message = (
                f"Sanction escalation required for '{tool}' — poll request "
                f"{decision.request_id} for the grant, then retry."
            )
        else:
            message = (
                f"Sanction denied '{tool}': "
                f"{decision.code or decision.reason or 'not authorized'}"
            )
        super().__init__(message, status=403, code=decision.code, body=decision)
        self.tool = tool
        self.decision = decision
