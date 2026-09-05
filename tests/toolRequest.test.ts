import { describe, it, expect, vi } from "vitest"
vi.mock("@/lib/credentialCrypto", async (orig) => {
  const mod = await orig<typeof import("@/lib/credentialCrypto")>()
  const key = Buffer.alloc(32, 7)
  return { ...mod,
    encryptCredentialEnvelope: async (text: string, wallet: string, label: string) => ({ blob: mod.encryptV3(text, key, wallet, label), keyId: "test-key" }),
    decryptCredentialEnvelope: async (r: { encryptedValue: string; walletId: string; label: string }) => mod.decryptV3(r.encryptedValue, key, r.walletId, r.label),
  }
})

import { canonicalToolRequest, sealToolRequest, openToolRequest } from "../lib/toolRequest"
import { toolGrantMatches } from "../lib/grants"

const original = { tool: "deploy", server: "release", arguments: { target: "staging", ref: "abc", nested: { a: 1, b: [true, null] }, token: "secret-value" } }

describe("encrypted tool request binding", () => {
  it("round trips only for the wallet; persisted data contains no arguments", async () => {
    const requestBinding = await sealToolRequest("w1", original)
    expect(JSON.stringify(requestBinding)).not.toContain("secret-value")
    expect(JSON.stringify(requestBinding)).not.toContain("staging")
    expect(await openToolRequest("w1", { requestBinding })).toBe(canonicalToolRequest(original))
    await expect(openToolRequest("w2", { requestBinding })).rejects.toThrow()
  })
  it("accepts reordered keys but rejects mutations of every authority field", async () => {
    const resource = { requestBinding: await sealToolRequest("w1", original) }
    expect(await toolGrantMatches(resource, { ...original, arguments: { token: "secret-value", nested: { b: [true, null], a: 1 }, ref: "abc", target: "staging" } }, "w1")).toBe(true)
    for (const change of [
      { tool: "delete" }, { server: "other" },
      { arguments: { ...original.arguments, target: "production" } },
      { arguments: { ...original.arguments, ref: "def" } },
      { arguments: { ...original.arguments, token: "changed" } },
      { arguments: { ...original.arguments, nested: { a: "1", b: [true, null] } } },
      { arguments: { ...original.arguments, nested: { a: 1, b: [null, true] } } },
      { arguments: {} },
    ]) expect(await toolGrantMatches(resource, { ...original, ...change }, "w1")).toBe(false)
  })
  it("normalizes absent arguments, rejects legacy and corrupt bindings", async () => {
    const resource = { requestBinding: await sealToolRequest("w1", { tool: "read" }) }
    expect(await toolGrantMatches(resource, { tool: "read", arguments: {} }, "w1")).toBe(true)
    expect(await toolGrantMatches({ kind: "tool", tool: "read" }, { tool: "read" }, "w1")).toBe(false)
    expect(await toolGrantMatches({ requestBinding: { ...resource.requestBinding, encryptedValue: "bad" } }, { tool: "read" }, "w1")).toBe(false)
    expect(await toolGrantMatches({ requestBinding: { ...resource.requestBinding, version: 2 } }, { tool: "read" }, "w1")).toBe(false)
  })
  it("rejects oversized, deeply nested, and non-finite values", () => {
    expect(() => canonicalToolRequest({ tool: "x", arguments: { x: "x".repeat(65536) } })).toThrow()
    let deep: Record<string, unknown> = {}
    for (let i = 0; i < 34; i++) deep = { deep }
    expect(() => canonicalToolRequest({ tool: "x", arguments: deep })).toThrow()
    expect(() => canonicalToolRequest({ tool: "x", arguments: { n: Infinity } })).toThrow()
  })
})
