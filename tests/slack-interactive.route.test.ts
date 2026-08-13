import { createHmac } from "crypto"
import { NextRequest } from "next/server"
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"

const { dbMock, rateLimitMock, resolveMock } = vi.hoisted(() => ({
  dbMock: {
    pendingApproval: { findFirst: vi.fn() },
  },
  rateLimitMock: vi.fn(),
  resolveMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("@/lib/rateLimit", async (orig) => {
  const mod = await orig<typeof import("../lib/rateLimit")>()
  return { ...mod, rateLimit: rateLimitMock }
})
vi.mock("@/lib/approvals", () => ({
  resolveApproval: resolveMock,
}))

import { POST as slackInteractive } from "../app/api/slack/interactive/route"
import { SLACK_APPROVE_ACTION, SLACK_DENY_ACTION } from "../lib/slack"

const SECRET = "slack-signing-secret"

function signedRequest(payload: unknown, opts?: { timestamp?: string; secret?: string; signature?: string }) {
  const raw = new URLSearchParams({ payload: JSON.stringify(payload) }).toString()
  const timestamp = opts?.timestamp ?? String(Math.floor(Date.now() / 1000))
  const secret = opts?.secret ?? SECRET
  const signature =
    opts?.signature ??
    "v0=" + createHmac("sha256", secret).update(`v0:${timestamp}:${raw}`).digest("hex")
  return new NextRequest("https://test.local/api/slack/interactive", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": signature,
    },
    body: raw,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("SANCTION_SLACK_SIGNING_SECRET", SECRET)
  rateLimitMock.mockResolvedValue({ ok: true, limit: 60 })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("POST /api/slack/interactive", () => {
  it("fails closed when the signing secret is unset", async () => {
    vi.stubEnv("SANCTION_SLACK_SIGNING_SECRET", "")
    const res = await slackInteractive(signedRequest({ type: "block_actions" }))
    expect(res.status).toBe(503)
  })

  it("401s a bad signature without resolving", async () => {
    const res = await slackInteractive(signedRequest({ type: "block_actions" }, { signature: "v0=" + "ab".repeat(32) }))
    expect(res.status).toBe(401)
    expect(resolveMock).not.toHaveBeenCalled()
  })

  it("429s when the per-IP limiter trips", async () => {
    rateLimitMock.mockResolvedValue({ ok: false, retryAfter: 12, limit: 60 })
    const res = await slackInteractive(signedRequest({ type: "block_actions" }))
    expect(res.status).toBe(429)
    expect(res.headers.get("Retry-After")).toBe("12")
  })

  it("approves through resolveApproval and replaces the Slack message", async () => {
    dbMock.pendingApproval.findFirst.mockResolvedValue({ id: "appr_1", walletId: "wallet_1" })
    resolveMock.mockResolvedValue({ ok: true, status: 200 })
    const res = await slackInteractive(
      signedRequest({
        type: "block_actions",
        user: { username: "eric" },
        actions: [{ action_id: SLACK_APPROVE_ACTION, value: "appr_1" }],
      }),
    )
    expect(res.status).toBe(200)
    expect(resolveMock).toHaveBeenCalledWith("wallet_1", "appr_1", "approve", undefined, "slack:eric")
    const body = await res.json()
    expect(body.replace_original).toBe(true)
    expect(body.blocks[0].text.text).toContain("Approved")
  })

  it("denies through the same resolver", async () => {
    dbMock.pendingApproval.findFirst.mockResolvedValue({ id: "appr_1", walletId: "wallet_1" })
    resolveMock.mockResolvedValue({ ok: true, status: 200 })
    await slackInteractive(
      signedRequest({
        type: "block_actions",
        user: { id: "U123" },
        actions: [{ action_id: SLACK_DENY_ACTION, value: "appr_1" }],
      }),
    )
    expect(resolveMock).toHaveBeenCalledWith("wallet_1", "appr_1", "reject", undefined, "slack:U123")
  })

  it("returns an ephemeral note when the approval is gone", async () => {
    dbMock.pendingApproval.findFirst.mockResolvedValue(null)
    const res = await slackInteractive(
      signedRequest({
        type: "block_actions",
        user: { username: "eric" },
        actions: [{ action_id: SLACK_APPROVE_ACTION, value: "missing" }],
      }),
    )
    expect(resolveMock).not.toHaveBeenCalled()
    const body = await res.json()
    expect(body.response_type).toBe("ephemeral")
  })

  it("returns the resolver error when the approval is already settled", async () => {
    dbMock.pendingApproval.findFirst.mockResolvedValue({ id: "appr_1", walletId: "wallet_1" })
    resolveMock.mockResolvedValue({ ok: false, error: "Approval already approved", status: 409 })
    const res = await slackInteractive(
      signedRequest({
        type: "block_actions",
        user: { username: "eric" },
        actions: [{ action_id: SLACK_APPROVE_ACTION, value: "appr_1" }],
      }),
    )
    const body = await res.json()
    expect(body.response_type).toBe("ephemeral")
    expect(body.text).toContain("already approved")
  })
})
