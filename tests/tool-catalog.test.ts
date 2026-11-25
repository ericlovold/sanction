import { describe, expect, it } from "vitest"
import { TOOL_CATALOG, pickedTools, toolForProvider } from "@/lib/toolCatalog"
import { PROVIDERS } from "@/lib/providers"
import { USAGE_PROVIDERS } from "@/lib/connectors/registry"

const methods = TOOL_CATALOG.flatMap((t) => t.methods.map((m) => ({ tool: t.id, ...m })))
const links = (m: (typeof methods)[number]) =>
  [m.providerId, m.usageProviderId, m.usageSource, m.billingProduct].filter((v) => v !== undefined)

describe("tool catalog", () => {
  it("has unique tool ids and unique method labels per tool", () => {
    expect(new Set(TOOL_CATALOG.map((t) => t.id)).size).toBe(TOOL_CATALOG.length)
    for (const t of TOOL_CATALOG) expect(new Set(t.methods.map((m) => m.label)).size).toBe(t.methods.length)
  })

  it("gives every built method a place to connect and exactly one proof of connection", () => {
    for (const m of methods.filter((m) => m.built)) {
      expect(m.href, `${m.tool}: ${m.label}`).toMatch(/^\/dashboard\//)
      expect(links(m), `${m.tool}: ${m.label}`).toHaveLength(1)
    }
  })

  it("never offers an unbuilt method as a link", () => {
    for (const m of methods.filter((m) => !m.built)) {
      expect(m.href, `${m.tool}: ${m.label}`).toBeUndefined()
      expect(links(m), `${m.tool}: ${m.label}`).toHaveLength(0)
    }
  })

  it("states what each method shows and cannot show", () => {
    for (const m of methods) {
      expect(m.shows.length, m.label).toBeGreaterThan(10)
      expect(m.cannotShow.length, m.label).toBeGreaterThan(10)
    }
  })

  it("lets only an API key routed through the gateway stop spend", () => {
    for (const m of methods) expect(m.canEnforce, m.label).toBe(m.bucket === "api_key")
    for (const m of methods.filter((m) => m.bucket === "api_key")) {
      expect(m.historyDays, m.label).toBe(0)
      expect(m.cannotShow, m.label).toContain("A normal API key cannot read the provider's usage or billing.")
    }
  })

  it("links only to providers the gateway and the usage registry know", () => {
    const gateway = new Set(PROVIDERS.map((p) => p.id))
    const usage = new Set(USAGE_PROVIDERS.map((p) => p.id))
    for (const m of methods) {
      if (m.providerId) expect(gateway.has(m.providerId), m.label).toBe(true)
      if (m.usageProviderId) expect(usage.has(m.usageProviderId), m.label).toBe(true)
    }
  })

  it("maps each gateway provider with a built key method back to its tool", () => {
    expect(toolForProvider("anthropic")?.id).toBe("claude")
    expect(toolForProvider("openai")?.id).toBe("openai")
    expect(toolForProvider("gemini")?.id).toBe("gemini")
    expect(toolForProvider("perplexity")).toBeUndefined()
  })
})

describe("pickedTools", () => {
  it("reads one or many picks, keeps catalog order and drops unknown ids", () => {
    expect(pickedTools(undefined)).toEqual([])
    expect(pickedTools("codex").map((t) => t.id)).toEqual(["codex"])
    expect(pickedTools(["cursor", "nope", "claude", "cursor"]).map((t) => t.id)).toEqual(["claude", "cursor"])
  })
})
