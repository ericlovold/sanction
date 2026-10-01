/** MCP presentation only: policy decisions are data, never tool failures. */
type Decision = {
  authorized: boolean
  status: string
  next_action: "proceed" | "wait" | "retry_with_grant" | "stop"
  request_id?: string
  code?: string
  reason?: string
  remediation?: string
  grant_status?: string
  grant_expires_at?: string | null
  grant_id?: string
}

const string = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value : undefined

export function renderDecisionResult(
  payload: unknown,
  opts: { success?: string; verb?: string; requestId?: string },
) {
  const polling = opts.requestId !== undefined
  const record = payload !== null && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown> : undefined
  const result = record ?? {}
  const status = string(result.status)
  const requestId = string(result.request_id)
  const decision: Decision = {
    authorized: false,
    status: status ?? "error",
    next_action: "stop",
  }
  for (const field of ["code", "reason", "remediation", "grant_status"] as const) {
    const value = string(result[field])
    if (value) decision[field] = value
  }
  if (requestId || opts.requestId) decision.request_id = requestId ?? opts.requestId
  if (result.grant_expires_at === null || string(result.grant_expires_at)) {
    decision.grant_expires_at = result.grant_expires_at as string | null
  }

  const hasError = result.error !== undefined && result.error !== null
  const knownStatus = status === "approved" || status === "denied" || status === "escalated" || status === "pending"
  const malformed = !record
    || (result.status !== undefined && !status)
    || (result.authorized !== undefined && typeof result.authorized !== "boolean")
    || (result.request_id != null && !requestId)
    || (polling && requestId !== undefined && requestId !== opts.requestId)
    || (polling && result.authorized !== undefined && result.authorized !== (status === "approved"))
    || (polling ? !knownStatus : result.authorized === true
      ? status !== undefined && status !== "approved" && status !== "allowed"
      : result.authorized !== false || !knownStatus || status === "approved")
  const isError = hasError || malformed
  let text: string
  if (isError) {
    decision.status = status === "unreachable" ? "unreachable" : "error"
    decision.code ??= hasError ? "SANCTION_ERROR" : "SANCTION_INVALID_RESPONSE"
    decision.reason ??= string(result.error) ?? "Sanction returned a malformed or contradictory decision."
    // An untrusted/mismatched response cannot identify the polled request.
    if (polling) decision.request_id = opts.requestId
    text = `${decision.code} — ${decision.reason}. Do not ${opts.verb ?? "proceed"}; stop and notify the owner. Do not retry automatically.`
  } else if (!polling && result.authorized === true) {
    decision.authorized = true
    decision.status = "approved"
    decision.next_action = "proceed"
    text = `${opts.success ?? "Authorized"}${requestId ? ` (${requestId})` : ""}${decision.grant_status === "consumed" ? " · grant consumed" : ""}`
  } else if (status === "escalated" || status === "pending") {
    decision.next_action = "wait"
    text = `${status.toUpperCase()} — ${decision.reason ?? "Still awaiting the owner's approval"}. Do not ${opts.verb ?? "proceed"}. Pause and wait for human review${decision.request_id ? `, then call sanction_check_authorization once with request_id: ${decision.request_id}` : "; notify the owner because no request_id was returned"}.`
  } else if (polling && status === "approved") {
    const grantId = string(result.grant_id)
    const expiry = result.grant_expires_at
    const validExpiry = expiry === null || (typeof expiry === "string"
      && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(expiry)
      && Number.isFinite(Date.parse(expiry)) && Date.parse(expiry) > Date.now())
    if (result.grant_status === "active" && grantId && validExpiry && result.grant_consumed_at == null) {
      decision.grant_id = grantId
      decision.next_action = "retry_with_grant"
      text = `APPROVED — retry your original request with identical fields plus grant_id: ${grantId}. This check does not authorize execution; proceed only when that authorize call returns authorized:true.`
    } else {
      text = `APPROVED — no usable active grant is available${decision.grant_status ? ` (grant ${decision.grant_status})` : ""}. Do not proceed or reuse a grant; stop and notify the owner.`
    }
  } else {
    text = `DENIED${decision.code ? ` (${decision.code})` : ""} — ${decision.reason ?? "Not authorized"}. Do not ${opts.verb ?? "proceed"}.`
  }
  return { content: [{ type: "text" as const, text }], structuredContent: { ...decision }, isError }
}
