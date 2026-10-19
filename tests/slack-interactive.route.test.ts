import { SignJWT } from "jose"
import { createHmac } from "crypto"
import { NextRequest } from "next/server"
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"

const { dbMock, rateLimitMock, resolveMock, afterMock, fetchMock } = vi.hoisted(() => ({
  dbMock: {
    pendingApproval: { findFirst: vi.fn() },
    slackInstall: { findFirst: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  },
  rateLimitMock: vi.fn(),
  resolveMock: vi.fn(),
  afterMock: vi.fn(),
  fetchMock: vi.fn(),
}))

vi.mock("next/server", async (orig) => ({
  ...await orig<typeof import("next/server")>(), after: afterMock,
}))
vi.mock("@vercel/analytics/server", () => ({ track: vi.fn(async () => {}) }))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("@/lib/rateLimit", async (orig) => {
  const mod = await orig<typeof import("../lib/rateLimit")>()
  return { ...mod, rateLimit: rateLimitMock }
})
vi.mock("@/lib/approvals", () => ({
  resolveApproval: resolveMock,
}))

import { POST as slackInteractive } from "../app/api/slack/interactive/route"
import { issueSlackActionToken, slackInstallGeneration, SLACK_APPROVE_ACTION, SLACK_DENY_ACTION } from "../lib/slack"

const SECRET = "slack-signing-secret"
const INSTALL = { id: "si_1", teamId: "T123", channelId: "C123", installedAt: new Date("2026-10-14T12:00:00.000Z"), botTokenEnc: "enc-original" }

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

async function approvalPayload(actionId: string, approvalId = "appr_1", opts?: { teamId?: string; channelId?: string }) {
  const teamId = opts?.teamId ?? "T123"
  const channelId = opts?.channelId ?? "C123"
  return {
    type: "block_actions",
    response_url: "https://hooks.slack.com/actions/T123/test/secret",
    team: { id: teamId },
    channel: { id: channelId },
    user: { username: "eric" },
    actions: [{ action_id: actionId, value: await issueSlackActionToken({ walletId: "wallet_1", approvalId, teamId: "T123", channelId: "C123", ...slackInstallGeneration(INSTALL) }) }],
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockResolvedValue(new Response("ok"))
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "info").mockImplementation(() => {})
  vi.stubEnv("SANCTION_SLACK_SIGNING_SECRET", SECRET)
  vi.stubEnv("SANCTION_SIGNING_SECRET", "sanction-signing-secret")
  rateLimitMock.mockResolvedValue({ ok: true, limit: 60 })
  dbMock.$transaction.mockImplementation(async (fn: (tx: typeof dbMock) => unknown) => await fn(dbMock))
  dbMock.slackInstall.findFirst.mockResolvedValue(INSTALL)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function delivered(res: Response) {
  expect(res.status).toBe(200)
  expect(await res.text()).toBe("")
  const callback = afterMock.mock.calls.at(-1)?.[0]
  expect(callback).toBeTypeOf("function")
  await callback()
  return JSON.parse(fetchMock.mock.calls.at(-1)![1].body)
}

describe("POST /api/slack/interactive", () => {
  it("rejects pre-generation tokens before accessing installations or approvals", async () => {
    const payload = await approvalPayload(SLACK_APPROVE_ACTION)
    payload.actions[0].value = await new SignJWT({ purpose: "slack-approval-action", walletId: "wallet_1", approvalId: "appr_1", teamId: "T123", channelId: "C123" })
      .setProtectedHeader({ alg: "HS256" }).setIssuer("sanction").setExpirationTime("2h")
      .sign(new TextEncoder().encode("sanction-signing-secret"))
    const res = await slackInteractive(signedRequest(payload))
    expect((await delivered(res)).text).toContain("no longer valid")
    expect(dbMock.slackInstall.findFirst).not.toHaveBeenCalled()
    expect(resolveMock).not.toHaveBeenCalled()
  })

  it.each([SLACK_APPROVE_ACTION, SLACK_DENY_ACTION])("keeps an old %s button invalid through disconnect and same-channel reinstall, even within one millisecond", async (actionId) => {
    let current: typeof INSTALL | null = INSTALL
    dbMock.slackInstall.findFirst.mockImplementation(async ({ where }) =>
      current && current.id === where.id && current.installedAt.getTime() === where.installedAt.getTime()
        && current.teamId === where.teamId && current.channelId === where.channelId && where.walletId === "wallet_1"
        && where.revokedAt === null ? current : null)
    dbMock.pendingApproval.findFirst.mockResolvedValue({ id: "appr_1", walletId: "wallet_1" })
    resolveMock.mockResolvedValue({ ok: true, status: 200 })
    const oldPayload = await approvalPayload(actionId)
    expect((await delivered(await slackInteractive(signedRequest(oldPayload)))).replace_original).toBe(true)
    resolveMock.mockClear()
    current = null
    await slackInteractive(signedRequest(oldPayload))
    expect(resolveMock).not.toHaveBeenCalled()
    current = { ...INSTALL, botTokenEnc: "enc-reinstalled" }
    await slackInteractive(signedRequest(oldPayload))
    expect(resolveMock).not.toHaveBeenCalled()
    const freshPayload = await approvalPayload(actionId)
    freshPayload.actions[0].value = await issueSlackActionToken({ walletId: "wallet_1", approvalId: "appr_1", teamId: "T123", channelId: "C123", ...slackInstallGeneration(current) })
    expect((await delivered(await slackInteractive(signedRequest(freshPayload)))).replace_original).toBe(true)
    expect(resolveMock).toHaveBeenCalledTimes(1)
  })

  it("rejects a replaced installation timestamp even when its ciphertext is unchanged", async () => {
    const reinstalled = { ...INSTALL, installedAt: new Date(INSTALL.installedAt.getTime() + 1) }
    dbMock.slackInstall.findFirst.mockImplementation(async ({ where }) =>
      where.installedAt.getTime() === reinstalled.installedAt.getTime() ? reinstalled : null)
    dbMock.pendingApproval.findFirst.mockResolvedValue({ id: "appr_1", walletId: "wallet_1" })
    resolveMock.mockResolvedValue({ ok: true, status: 200 })
    const payload = await approvalPayload(SLACK_APPROVE_ACTION)
    await slackInteractive(signedRequest(payload))
    expect(resolveMock).not.toHaveBeenCalled()
    payload.actions[0].value = await issueSlackActionToken({ walletId: "wallet_1", approvalId: "appr_1", teamId: "T123", channelId: "C123", ...slackInstallGeneration(reinstalled) })
    await slackInteractive(signedRequest(payload))
    expect(resolveMock).toHaveBeenCalledTimes(1)
  })

  it("fails closed when the signing secret is unset", async () => {
    vi.stubEnv("SANCTION_SLACK_SIGNING_SECRET", "")
    const res = await slackInteractive(signedRequest({ type: "block_actions" }))
    expect(res.status).toBe(503)
  })

  it("401s a bad signature without resolving", async () => {
    const res = await slackInteractive(signedRequest(await approvalPayload(SLACK_APPROVE_ACTION), { signature: "v0=" + "ab".repeat(32) }))
    expect(res.status).toBe(401)
    expect(afterMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
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
      signedRequest(await approvalPayload(SLACK_APPROVE_ACTION)),
    )
    expect(res.status).toBe(200)
    expect(resolveMock).toHaveBeenCalledWith("wallet_1", "appr_1", "approve", undefined, "slack:eric")
    const body = await delivered(res)
    expect(body.replace_original).toBe(true)
    expect(body.blocks[0].text.text).toContain("Approved")
  })

  it("denies through the same resolver", async () => {
    dbMock.pendingApproval.findFirst.mockResolvedValue({ id: "appr_1", walletId: "wallet_1" })
    resolveMock.mockResolvedValue({ ok: true, status: 200 })
    const res = await slackInteractive(
      signedRequest({ ...(await approvalPayload(SLACK_DENY_ACTION)), user: { id: "U123" } }),
    )
    expect((await delivered(res)).text).toContain("Denied")
    expect(resolveMock).toHaveBeenCalledWith("wallet_1", "appr_1", "reject", undefined, "slack:U123")
  })

  it("returns an ephemeral note when the approval is gone", async () => {
    dbMock.pendingApproval.findFirst.mockResolvedValue(null)
    const res = await slackInteractive(
      signedRequest(await approvalPayload(SLACK_APPROVE_ACTION, "missing")),
    )
    expect(resolveMock).not.toHaveBeenCalled()
    const body = await delivered(res)
    expect(body.response_type).toBe("ephemeral")
    expect(body.replace_original).toBe(false)
  })

  it("returns the resolver error when the approval is already settled", async () => {
    dbMock.pendingApproval.findFirst.mockResolvedValue({ id: "appr_1", walletId: "wallet_1" })
    resolveMock.mockResolvedValue({ ok: false, error: "Approval already approved", status: 409 })
    const res = await slackInteractive(
      signedRequest(await approvalPayload(SLACK_APPROVE_ACTION)),
    )
    const body = await delivered(res)
    expect(body.response_type).toBe("ephemeral")
    expect(body.replace_original).toBe(false)
    expect(body.text).toContain("already approved")
  })

  it("refuses a signed action from another Slack channel before reading approvals", async () => {
    const res = await slackInteractive(signedRequest(await approvalPayload(SLACK_APPROVE_ACTION, "appr_1", { channelId: "C999" })))
    expect(res.status).toBe(200)
    expect(dbMock.pendingApproval.findFirst).not.toHaveBeenCalled()
    expect(resolveMock).not.toHaveBeenCalled()
    expect((await delivered(res)).text).toContain("no longer valid")
  })

  it("refuses a workspace/channel with no active install before reading approvals", async () => {
    dbMock.slackInstall.findFirst.mockResolvedValue(null)
    const res = await slackInteractive(signedRequest(await approvalPayload(SLACK_APPROVE_ACTION)))
    expect(dbMock.pendingApproval.findFirst).not.toHaveBeenCalled()
    expect(resolveMock).not.toHaveBeenCalled()
    expect((await delivered(res)).text).toContain("no longer authorized")
  })
  it("acknowledges before delivery and never retries a decision after delivery failure", async () => {
    dbMock.pendingApproval.findFirst.mockResolvedValue({ id: "appr_1", walletId: "wallet_1" })
    resolveMock.mockResolvedValue({ ok: true, status: 200 })
    fetchMock.mockRejectedValue(new Error("secret response URL"))
    const res = await slackInteractive(signedRequest(await approvalPayload(SLACK_APPROVE_ACTION)))
    expect(await res.text()).toBe("")
    expect(fetchMock).not.toHaveBeenCalled()
    await afterMock.mock.calls[0][0]()
    expect(resolveMock).toHaveBeenCalledTimes(1)
    expect(console.warn).toHaveBeenCalledWith("Slack interaction feedback", { kind: "decided", outcome: "network_error" })
  })

})
