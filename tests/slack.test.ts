import { createHmac } from "crypto"
import { describe, expect, it } from "vitest"
import {
  parseSlackInteractiveBody,
  slackChannelIdFromUrl,
  slackDecisionFromPayload,
  slackInteractivePayload,
  SLACK_APPROVE_ACTION,
  SLACK_DENY_ACTION,
  verifySlackSignature,
} from "../lib/slack"

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

describe("slackChannelIdFromUrl", () => {
  it("reads C-ids from archive URLs and incoming-webhook query params", () => {
    expect(slackChannelIdFromUrl("https://slack.com/archives/C0123456789")).toBe("C0123456789")
    expect(slackChannelIdFromUrl("https://hooks.slack.com/services/T/B/x?channel=C0ABCDEFG")).toBe("C0ABCDEFG")
    expect(slackChannelIdFromUrl("https://hooks.slack.com/services/T/B/x")).toBeNull()
    expect(slackChannelIdFromUrl("https://api.example.com/hook")).toBeNull()
  })
})

describe("slack interactive payload", () => {
  it("parses approve/deny from a block_actions body", () => {
    const raw = new URLSearchParams({
      payload: JSON.stringify({
        type: "block_actions",
        user: { username: "eric" },
        actions: [{ action_id: SLACK_APPROVE_ACTION, value: "appr_1" }],
      }),
    }).toString()
    const parsed = parseSlackInteractiveBody(raw)
    expect(slackDecisionFromPayload(parsed)).toEqual({
      decision: "approve",
      approvalId: "appr_1",
      actor: "slack:eric",
    })
  })

  it("puts Approve/Deny actions on escalation events when approval_id is present", () => {
    const payload = JSON.parse(
      slackInteractivePayload(
        "approval.created",
        { approval_id: "appr_9", approve_url: "https://getsanction.com/dashboard/approvals?review=req_1" },
        ":hourglass: needs approval",
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
