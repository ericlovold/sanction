// The runaway alert email must be honest about what Sanction did: it reports
// provider numbers that run behind, and it stopped nothing.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { usd } from "../lib/connectors/money"

beforeEach(() => { vi.resetModules() })
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const alert = (over: Record<string, unknown> = {}) => ({
  rule: "runaway_rate", provider: "cursor", subjectType: "conversation", subjectKey: "conv-1",
  windowStart: new Date(Date.UTC(2026, 10, 17, 2)), windowEnd: new Date(Date.UTC(2026, 10, 17, 3)),
  observedNanos: usd(20), thresholdNanos: usd(9), evidence: { identity: "dev@example.test", billedNanos: usd(20).toString() },
  ...over,
})

async function send(alerts: ReturnType<typeof alert>[]) {
  vi.stubEnv("RESEND_API_KEY", "test-only-provider-key")
  const fetchMock = vi.fn().mockResolvedValue({ ok: true })
  vi.stubGlobal("fetch", fetchMock)
  const { sendUsageAlertEmail } = await import("../lib/email")
  await sendUsageAlertEmail("owner@example.test", { walletName: "Acme <Labs>", alerts })
  return JSON.parse(fetchMock.mock.calls[0][1].body) as { to: string; subject: string; text: string; html: string }
}

describe("sendUsageAlertEmail", () => {
  it("states the amount, the line, the window, who, and that nothing was stopped", async () => {
    const message = await send([alert()])
    expect(message.to).toBe("owner@example.test")
    expect(message.subject).toBe("AI spend alert: Spend spiked far above this person's normal hour")
    expect(message.text).toContain("conversation conv-1 (dev@example.test)")
    expect(message.text).toContain("$20.00 in cursor usage between 2026-11-17 02:00 UTC and 2026-11-17 03:00 UTC, against a line of $9.00. Billed so far: $20.00.")
    expect(message.text).toContain("Sanction has not stopped anything")
    expect(message.text).toContain("about an hour behind")
    expect(message.text).toContain("https://getsanction.com/dashboard/ai-spend")
    expect(message.html).toContain("Sanction has not stopped anything")
  })

  it("batches several alerts into one message and escapes provider-supplied text", async () => {
    const message = await send([
      alert(),
      alert({ rule: "daily_cap", subjectType: "person", subjectKey: "x", evidence: { identity: "<script>@example.test", billedNanos: "0" } }),
      alert({ rule: "something_new" }),
    ])
    expect(message.subject).toBe("3 AI spend alerts for Acme <Labs>")
    expect(message.text).toContain("One person passed the daily spend line")
    expect(message.text).toContain("something_new")
    expect(message.html).toContain("&lt;script&gt;@example.test")
    expect(message.html).not.toContain("<script>")
  })
})

it("uses token and request units for high-volume alerts on included usage", async () => {
  const message = await send([alert({
    rule: "cursor_daily_volume", observedNanos: BigInt(0), thresholdNanos: BigInt(0),
    evidence: { identity: "dev@example.test", billedNanos: "0", volume: {
      reportedTokens: "120000000", cachedTokens: "110000000", requests: "1000", requestsWithTokens: "999",
      tokenThreshold: "100000000", requestThreshold: "5000",
    } },
  })])
  expect(message.text).toContain("120,000,000 reported tokens (110,000,000 cache reads), 1,000 requests")
  expect(message.text).toContain("UTC day: 2026-11-17. Billed so far: $0.00")
  expect(message.text).not.toContain("line of $0.00")
})
