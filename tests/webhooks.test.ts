import { describe, it, expect, vi } from "vitest"
import { createHmac } from "crypto"

// lib/webhooks security primitives: the SSRF guard on registered URLs and the
// HMAC-SHA256 delivery signature. Both are claims in docs/SECURITY.md — these
// tests are their regression net. Delivery itself is best-effort I/O and is
// exercised via the route tests (mocked) and the DB e2e.
vi.mock("@/lib/db", () => ({ db: {} }))

import { isPublicHttpsUrl, signBody, generateWebhookSecret } from "../lib/webhooks"

describe("isPublicHttpsUrl — SSRF guard on owner-registered webhook URLs", () => {
  it("accepts a normal public https URL", () => {
    expect(isPublicHttpsUrl("https://hooks.example.com/sanction")).toBe(true)
  })

  it.each([
    ["plain http", "http://hooks.example.com/x"],
    ["not a URL", "not a url"],
    ["file scheme", "file:///etc/passwd"],
  ])("rejects %s", (_label, url) => {
    expect(isPublicHttpsUrl(url)).toBe(false)
  })

  it.each([
    ["localhost", "https://localhost/hook"],
    ["loopback v4", "https://127.0.0.1/hook"],
    ["loopback v4 range", "https://127.1.2.3/hook"],
    ["loopback v6", "https://[::1]/hook"],
    ["unspecified", "https://0.0.0.0/hook"],
    ["RFC1918 10/8", "https://10.0.0.5/hook"],
    ["RFC1918 192.168/16", "https://192.168.1.1/hook"],
    ["RFC1918 172.16/12 low", "https://172.16.0.1/hook"],
    ["RFC1918 172.16/12 high", "https://172.31.255.1/hook"],
    ["cloud metadata (link-local)", "https://169.254.169.254/latest/meta-data"],
    [".local suffix", "https://printer.local/hook"],
    [".internal suffix", "https://db.internal/hook"],
  ])("rejects %s", (_label, url) => {
    expect(isPublicHttpsUrl(url)).toBe(false)
  })

  it("does not over-block public addresses adjacent to private ranges", () => {
    expect(isPublicHttpsUrl("https://172.32.0.1/hook")).toBe(true) // just past 172.31.*
    expect(isPublicHttpsUrl("https://11.0.0.1/hook")).toBe(true) // not 10/8
  })

  it("is case-insensitive on the hostname", () => {
    expect(isPublicHttpsUrl("https://LOCALHOST/hook")).toBe(false)
  })
})

describe("signBody — webhook delivery signature", () => {
  it("produces the documented sha256= HMAC over the exact body", () => {
    const secret = "whsec_test"
    const body = JSON.stringify({ event: "approval.created", n: 1 })
    const expected = "sha256=" + createHmac("sha256", secret).update(body).digest("hex")
    expect(signBody(secret, body)).toBe(expected)
  })

  it("changes when a single body byte changes (receiver can detect tampering)", () => {
    const secret = "whsec_test"
    expect(signBody(secret, '{"amount":10}')).not.toBe(signBody(secret, '{"amount":11}'))
  })

  it("changes with the secret (one wallet's signature can't validate another's)", () => {
    expect(signBody("whsec_a", "{}")).not.toBe(signBody("whsec_b", "{}"))
  })
})

describe("generateWebhookSecret", () => {
  it("issues distinct, prefixed, high-entropy secrets", () => {
    const a = generateWebhookSecret()
    const b = generateWebhookSecret()
    expect(a).toMatch(/^whsec_[0-9a-f]{48}$/)
    expect(a).not.toBe(b)
  })
})

describe("approveUrlFor (APPROVE-UX)", () => {
  it("deep-links the specific decision and falls back to the inbox", async () => {
    const { approveUrlFor, APPROVE_URL } = await import("../lib/webhooks")
    expect(approveUrlFor("req_123")).toBe(`${APPROVE_URL}?review=req_123`)
    expect(approveUrlFor(null)).toBe(APPROVE_URL)
    expect(approveUrlFor(undefined)).toBe(APPROVE_URL)
    // ids are URL-encoded so a hostile id can't break out of the query
    expect(approveUrlFor("a b&c")).toBe(`${APPROVE_URL}?review=a%20b%26c`)
  })
})
