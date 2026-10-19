import { createHmac } from "crypto"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  parseSlackInteractiveBody,
  slackResponseUrl,
  postSlackInteractionFeedback,
  isSlackArchiveUrl,
  slackDecisionFromPayload,
  slackInteractivePayload,
  issueSlackActionToken,
  slackInstallGeneration,
  verifySlackActionToken,
  postSlackChat,
  SLACK_APPROVE_ACTION,
  SLACK_DENY_ACTION,
  verifySlackSignature,
} from "../lib/slack"

const INSTALL = { id: "si_1", teamId: "T123", channelId: "C123", installedAt: new Date("2026-10-14T12:00:00.000Z"), botTokenEnc: "enc" }

const SECRET = "slack-signing-secret"
const TS = "1710000000"
const BODY = "payload=%7B%7D"

function sig(secret: string, timestamp: string, raw: string) {
  return "v0=" + createHmac("sha256", secret).update(`v0:${timestamp}:${raw}`).digest("hex")
}

describe("verifySlackSignature", () => {
  const nowMs = Number(TS) * 1000

  it("accepts a matching v0 HMAC within the 5-minute window", () => {
    expect(
      verifySlackSignature({
        signingSecret: SECRET,
        timestamp: TS,
        rawBody: BODY,
        signature: sig(SECRET, TS, BODY),
        nowMs,
      }),
    ).toBe(true)
  })

  it("rejects a wrong secret, stale timestamp, and missing v0 prefix", () => {
    const good = sig(SECRET, TS, BODY)
    expect(
      verifySlackSignature({
        signingSecret: "other",
        timestamp: TS,
        rawBody: BODY,
        signature: good,
        nowMs,
      }),
    ).toBe(false)
    expect(
      verifySlackSignature({
        signingSecret: SECRET,
        timestamp: TS,
        rawBody: BODY,
        signature: good,
        nowMs: nowMs + 6 * 60 * 1000,
      }),
    ).toBe(false)
    expect(
      verifySlackSignature({
        signingSecret: SECRET,
        timestamp: TS,
        rawBody: BODY,
        signature: good.slice(3),
        nowMs,
      }),
    ).toBe(false)
  })
})

describe("isSlackArchiveUrl", () => {
  it.each(["https://slack.com/archives/C0123456789", "https://app.slack.com/archives/C123", "https://example.slack.com/archives/C123"])("rejects archive destination %s", (url) => {
    expect(isSlackArchiveUrl(url)).toBe(true)
  })
  it.each(["https://hooks.slack.com/services/T/B/x?channel=C123", "https://api.example.com/archives/C123", "invalid"])("does not classify a webhook as an archive: %s", (url) => {
    expect(isSlackArchiveUrl(url)).toBe(false)
  })
})

describe("slack interactive payload", () => {
  it("parses approve/deny and its Slack workspace context", async () => {
    process.env.SANCTION_SIGNING_SECRET = "test-signing-secret"
    const actionToken = await issueSlackActionToken({ walletId: "wallet_1", approvalId: "appr_1", teamId: "T123", channelId: "C123", ...slackInstallGeneration(INSTALL) })
    const raw = new URLSearchParams({
      payload: JSON.stringify({
        type: "block_actions",
        user: { username: "eric" },
        team: { id: "T123" },
        channel: { id: "C123" },
        actions: [{ action_id: SLACK_APPROVE_ACTION, value: actionToken }],
      }),
    }).toString()
    const parsed = parseSlackInteractiveBody(raw)
    expect(slackDecisionFromPayload(parsed)).toEqual({
      decision: "approve",
      actionToken,
      actor: "slack:eric",
      teamId: "T123",
      channelId: "C123",
    })
  })

  it("puts Approve/Deny actions on escalation events when approval_id is present", () => {
    const payload = JSON.parse(
      slackInteractivePayload(
        "approval.created",
        { approval_id: "appr_9", approve_url: "https://getsanction.com/dashboard/approvals?review=req_1" },
        ":hourglass: needs approval",
        "signed-action-token",
      ),
    )
    const ids = payload.blocks[1].elements.map((el: { action_id?: string }) => el.action_id)
    expect(ids).toContain(SLACK_APPROVE_ACTION)
    expect(ids).toContain(SLACK_DENY_ACTION)
    expect(payload.blocks[1].elements[2]).toMatchObject({
      type: "button",
      url: expect.stringContaining("review=req_1"),
    })
  })

  it("omits action buttons when there is no approval_id", () => {
    const payload = JSON.parse(slackInteractivePayload("approval.created", {}, "needs approval"))
    expect(payload.blocks[1].elements).toHaveLength(1)
    expect(payload.blocks[1].elements[0].url).toContain("/dashboard/approvals")
  })
})


describe("Slack installation generation", () => {
  it.each(["invalid", "2026-99-99T00:00:00.000Z", "2026-10-14", "2026-10-14T12:00:00Z"])("rejects malformed/noncanonical timestamp %s", async (installedAt) => {
    process.env.SANCTION_SIGNING_SECRET = "test-signing-secret"
    const token = await issueSlackActionToken({ walletId: "wallet_1", approvalId: "appr_1", teamId: "T123", channelId: "C123", ...slackInstallGeneration(INSTALL), installedAt })
    expect(await verifySlackActionToken(token)).toBeNull()
  })
})

describe("postSlackChat bounded delivery outcomes", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

  it.each(["token_revoked", "token_expired", "account_inactive"] as const)("recognizes definite %s failures", async (error) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false, error })))
    expect(await postSlackChat("C123", '{"text":"test"}', "xoxb-test")).toEqual({ ok: false, error })
  })

  it.each(["invalid_auth", "not_in_channel", "channel_not_found", "is_archived", "ratelimited", "internal_error", "private-token-value"])("does not classify %s as revoked", async (error) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false, error })))
    expect(await postSlackChat("C123", '{"text":"test"}', "xoxb-test")).toEqual({ ok: false, error: "slack_rejected" })
  })

  it.each([429, 500, 503])("does not trust token errors in HTTP %s responses", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false, error: "token_revoked" }, { status })))
    expect(await postSlackChat("C123", '{"text":"test"}', "xoxb-test")).toEqual({ ok: false, error: "http_error" })
  })

  it("bounds network and malformed-response failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("private-token-value") }))
    expect(await postSlackChat("C123", '{"text":"test"}', "xoxb-test")).toEqual({ ok: false, error: "network_error" })
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not json")))
    expect(await postSlackChat("C123", '{"text":"test"}', "xoxb-test")).toEqual({ ok: false, error: "invalid_response" })
  })

  it("bounds a timeout without treating it as revocation", async () => {
    vi.useFakeTimers()
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new Error("aborted")))
    })))
    const pending = postSlackChat("C123", '{"text":"test"}', "xoxb-test")
    await vi.advanceTimersByTimeAsync(5000)
    expect(await pending).toEqual({ ok: false, error: "timeout" })
  })

  it("recognizes success and rejects missing tokens without sending", async () => {
    const fetch = vi.fn(async () => Response.json({ ok: true }))
    vi.stubGlobal("fetch", fetch)
    expect(await postSlackChat("C123", '{"text":"test"}', "")).toEqual({ ok: false, error: "missing_token" })
    expect(fetch).not.toHaveBeenCalled()
    expect(await postSlackChat("C123", '{"text":"test"}', "xoxb-test")).toEqual({ ok: true })
  })
})


describe("Slack interaction feedback", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it.each([
    null, {}, { response_url: 1 },
    ...[
      "http://hooks.slack.com/actions/test",
      "https://hooks.slack.com.evil.test/actions/test",
      "https://hooks.slack.com@evil.test/actions/test",
      "https://user@hooks.slack.com/actions/test",
      "https://hooks.slack.com:443/actions/test",
      "https://hooks.slack.com:8443/actions/test",
      "https://hooks.slack.com/archives/test",
      "https://hooks.slack.com/actions/../archives/test",
      "https://hooks.slack.com/actions/",
      "https://hooks.slack.com/actions/test?token=secret",
      "https://hooks.slack.com/actions/test#secret",
      "https://127.0.0.1/actions/test",
      "not a URL",
    ].map((response_url) => ({ response_url })),
  ])("rejects unsafe response endpoints: %j", async (payload) => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    const url = slackResponseUrl(payload)
    expect(url).toBeNull()
    await postSlackInteractionFeedback(url, { text: "test" })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(["actions", "services"])("posts feedback to Slack %s endpoints with redirects disabled", async (path) => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const fetch = vi.fn(async () => new Response("ok"))
    vi.stubGlobal("fetch", fetch)
    const url = `https://hooks.slack.com/${path}/T123/test/secret`
    const body = { response_type: "ephemeral", replace_original: false, text: "Rejected" }
    expect(slackResponseUrl({ response_url: url })).toBe(url)
    await postSlackInteractionFeedback(url, body)
    expect(fetch).toHaveBeenCalledWith(url, expect.objectContaining({
      method: "POST", body: JSON.stringify(body), redirect: "error", signal: expect.any(AbortSignal),
    }))
    expect(console.info).toHaveBeenCalledWith("Slack interaction feedback", { kind: "rejected", outcome: "delivered" })
  })

  it.each([302, 429, 500])("sanitizes HTTP %s failure diagnostics", async (status) => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.stubGlobal("fetch", vi.fn(async () => new Response("secret", { status })))
    await postSlackInteractionFeedback("https://hooks.slack.com/actions/secret", { replace_original: true })
    expect(console.warn).toHaveBeenCalledWith("Slack interaction feedback", { kind: "decided", outcome: "http_error" })
  })

  it("bounds feedback delivery to five seconds", async () => {
    vi.useFakeTimers()
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new Error("secret URL")))
    })))
    const pending = postSlackInteractionFeedback("https://hooks.slack.com/actions/secret", { replace_original: true })
    await vi.advanceTimersByTimeAsync(5000)
    await pending
    expect(console.warn).toHaveBeenCalledWith("Slack interaction feedback", { kind: "decided", outcome: "timeout" })
  })
})
