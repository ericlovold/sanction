/** Thrown for any non-2xx response from the Sanction API. */
export class SanctionError extends Error {
  readonly status: number
  /** Stable machine-readable code when the API supplies one (e.g. decision codes). */
  readonly code?: string
  /** Parsed response body, when available. */
  readonly body?: unknown

  constructor(message: string, opts: { status: number; code?: string; body?: unknown }) {
    super(message)
    this.name = "SanctionError"
    this.status = opts.status
    this.code = opts.code
    this.body = opts.body
  }
}

/**
 * A `denied` authorization is NOT thrown by default — it is a normal decision an
 * agent should branch on. Callers that prefer exceptions can opt in with
 * `throwOnDeny`, which raises this.
 */
export class AuthorizationDeniedError extends SanctionError {
  constructor(body: { reason?: string; code?: string }) {
    super(body.reason ?? "Authorization denied", { status: 403, code: body.code, body })
    this.name = "AuthorizationDeniedError"
  }
}
