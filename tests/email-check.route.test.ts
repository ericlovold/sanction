import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"

// Email health check: admin-gated, never leaks the key (masked prefix only),
// and maps Resend outcomes to actionable verdicts.

import { GET as emailCheck } from "../app/api/admin/email-check/route"

const SECRET = "test-admin-secret"

function req(headers: Record<string, string> = { "x-admin-secret": SECRET }, query = "") {
  return new NextRequest(`https://test.local/api/admin/email-check${query}`, { headers })
}

beforeEach(() => {
  vi.stubEnv("SANCTION_ADMIN_SECRET", SECRET)
  vi.stubEnv("RESEND_API_KEY", "re_1234567890abcdef")
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("GET /api/admin/email-check", () => {
  it("503s when the admin secret is not configured; 401s on a wrong one", async () => {
    vi.stubEnv("SANCTION_ADMIN_SECRET", "")
    expect((await emailCheck(req())).status).toBe(503)

    vi.stubEnv("SANCTION_ADMIN_SECRET", SECRET)
    expect((await emailCheck(req({ "x-admin-secret": "wrong" }))).status).toBe(401)
  })

  it("reports a missing RESEND_API_KEY without attempting a send", async () => {
    vi.stubEnv("RESEND_API_KEY", "")
    const fetchSpy = vi.spyOn(global, "fetch")

    const res = await emailCheck(req())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(false)
    expect(body.resend_key_present).toBe(false)
    expect(body.verdict).toContain("RESEND_API_KEY is not set")
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("sends via Resend and masks the key — never the full value", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response('{"id":"email_1"}', { status: 200 }))

    const res = await emailCheck(req(undefined, "?to=probe@example.com"))
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.resend_status).toBe(200)
    expect(body.attempted_to).toBe("probe@example.com")
    expect(body.verdict).toContain("Key and sending domain are working")
    // masked prefix only — the raw key must not appear anywhere in the response
    expect(body.resend_key_prefix).toBe("re_12…ef")
    expect(JSON.stringify(body)).not.toContain("re_1234567890abcdef")
  })

  it("maps a Resend 401 to the bad-key/unverified-domain verdict", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("unauthorized", { status: 401 }))

    const body = await (await emailCheck(req())).json()

    expect(body.ok).toBe(false)
    expect(body.resend_status).toBe(401)
    expect(body.verdict).toContain("bad/expired API key")
  })

  it("maps a Resend 422 to the unverified-from-domain verdict", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("{}", { status: 422 }))

    const body = await (await emailCheck(req())).json()

    expect(body.ok).toBe(false)
    expect(body.verdict).toContain('"from" domain')
  })

  it("survives a network failure with a diagnostic verdict, not a 500", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("ECONNRESET"))

    const res = await emailCheck(req())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(false)
    expect(body.verdict).toContain("Network error reaching Resend: ECONNRESET")
  })
})
