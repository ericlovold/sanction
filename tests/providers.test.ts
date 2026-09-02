// The provider-connection contract the gateway injection depends on: which
// header each upstream expects, when injection may fire, and model attribution.

import { describe, expect, it } from "vitest"
import { GATEWAY_ONLY_SENTINEL, PROVIDERS, hasProviderAuth, isReservedVaultLabel, providerAuthHeader, providerNameOf } from "../lib/providers"

describe("providerAuthHeader", () => {
  it("maps each provider to its native auth header", () => {
    expect(providerAuthHeader("anthropic", "sk-a")).toEqual({ name: "x-api-key", value: "sk-a" })
    expect(providerAuthHeader("gemini", "g-key")).toEqual({ name: "x-goog-api-key", value: "g-key" })
    expect(providerAuthHeader("openai", "sk-o")).toEqual({ name: "authorization", value: "Bearer sk-o" })
    expect(providerAuthHeader("perplexity", "pplx")).toEqual({ name: "authorization", value: "Bearer pplx" })
  })
})

describe("hasProviderAuth — injection only fires when the caller sent nothing", () => {
  it("detects each provider auth style", () => {
    expect(hasProviderAuth(new Headers({ authorization: "Bearer x" }))).toBe(true)
    expect(hasProviderAuth(new Headers({ "x-api-key": "sk" }))).toBe(true)
    expect(hasProviderAuth(new Headers({ "x-goog-api-key": "g" }))).toBe(true)
  })
  it("is false for a bare sanction-authenticated request", () => {
    expect(hasProviderAuth(new Headers({ "x-sanction-key": "pxy_x", "content-type": "application/json" }))).toBe(false)
  })
})

describe("providerNameOf attribution", () => {
  it("attributes model tags to providers", () => {
    expect(providerNameOf("claude-sonnet-4-6")).toBe("Anthropic")
    expect(providerNameOf("gpt-4o-mini")).toBe("OpenAI")
    expect(providerNameOf("o1-preview")).toBe("OpenAI")
    expect(providerNameOf("gemini-2.5-pro")).toBe("Google")
    expect(providerNameOf("sonar-pro")).toBe("Perplexity")
    expect(providerNameOf("llama-3.1-70b")).toBe("Other")
  })
})

describe("vault labels are reserved and stable", () => {
  it("every provider stores under provider:<id>", () => {
    for (const p of PROVIDERS) expect(p.vaultLabel).toBe(`provider:${p.id}`)
  })
})

describe("reserved vault labels (PROV-1 fix)", () => {
  it("provider:* and mcp:* are reserved; ordinary labels are not", () => {
    expect(isReservedVaultLabel("provider:anthropic")).toBe(true)
    expect(isReservedVaultLabel("mcp:github")).toBe(true)
    expect(isReservedVaultLabel("openai")).toBe(false)
    expect(isReservedVaultLabel("my-provider:key")).toBe(false)
  })
  it("the gateway-only sentinel can never equal a real agent id", () => {
    // Agent ids are cuids (no colon-free english words); the sentinel is
    // deliberately a phrase. Non-empty is the property that matters: an empty
    // allow-list means every agent in the wallet.
    expect(GATEWAY_ONLY_SENTINEL.length).toBeGreaterThan(0)
    expect(/^[a-z0-9]{20,}$/.test(GATEWAY_ONLY_SENTINEL)).toBe(false)
  })
})
