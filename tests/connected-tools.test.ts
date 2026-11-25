import { describe, expect, it } from "vitest"
import { connectedTools, type ConnectionSignals } from "@/lib/connectedTools"

// Nothing connected, and every read succeeded.
const none = (): ConnectionSignals => ({
  providerKeys: [],
  adminConnections: [],
  collectorDeliveries: [],
  billingExports: [],
  recordedUsd: new Map(),
  billedUsd: new Map(),
})

const ids = (view: ReturnType<typeof connectedTools>) => (view.kind === "tools" ? view.tools.map((t) => t.id) : [])

describe("connectedTools", () => {
  it("shows nothing and offers the buildable tools when nothing is connected", () => {
    const view = connectedTools(none())
    expect(view.kind).toBe("empty")
    if (view.kind !== "empty") return
    expect(view.addable.map((t) => t.id)).toEqual(["claude", "openai", "codex", "cursor", "gemini", "grok"])
  })

  it("says unavailable, not empty, when a read failed and nothing was found", () => {
    expect(connectedTools({ ...none(), providerKeys: null }).kind).toBe("unavailable")
    expect(connectedTools({ ...none(), billedUsd: null }).kind).toBe("unavailable")
  })

  it("still shows what it found when another read failed, and marks the view partial", () => {
    const view = connectedTools({ ...none(), providerKeys: null, adminConnections: [{ provider: "anthropic", health: "ok" }] })
    expect(view.kind).toBe("tools")
    if (view.kind !== "tools") return
    expect(view.partial).toBe(true)
    expect(ids(view)).toEqual(["claude"])
  })

  it("shows a stored key with no calls in words, never as $0", () => {
    const view = connectedTools({ ...none(), providerKeys: ["openai"] })
    if (view.kind !== "tools") throw new Error(view.kind)
    const [tool] = view.tools
    expect(tool.id).toBe("openai")
    expect(tool.headline).toBeNull()
    expect(tool.methods).toEqual([
      expect.objectContaining({ bucket: "api_key", state: "waiting", detail: "Key stored. No calls through Sanction yet this month." }),
    ])
  })

  it("keeps a recorded $0 as a real figure", () => {
    const view = connectedTools({ ...none(), providerKeys: ["gemini"], recordedUsd: new Map([["gemini", 0]]) })
    if (view.kind !== "tools") throw new Error(view.kind)
    expect(view.tools[0].headline).toEqual({ usd: 0, source: "recorded" })
    expect(view.tools[0].methods[0].state).toBe("ok")
  })

  it("never adds gateway spend to the provider-billed figure", () => {
    const view = connectedTools({
      ...none(),
      providerKeys: ["anthropic"],
      adminConnections: [{ provider: "anthropic", health: "ok" }],
      recordedUsd: new Map([["anthropic", 30]]),
      billedUsd: new Map([["anthropic", 120]]),
    })
    if (view.kind !== "tools") throw new Error(view.kind)
    const [claude] = view.tools
    expect(claude.headline).toEqual({ usd: 120, source: "billed" })
    expect(claude.alsoRecordedUsd).toBe(30)
    expect(claude.methods.map((m) => m.bucket)).toEqual(["admin_usage", "api_key"])
  })

  it("uses the recorded estimate only when nothing billed exists", () => {
    const view = connectedTools({ ...none(), recordedUsd: new Map([["anthropic", 4.5]]) })
    if (view.kind !== "tools") throw new Error(view.kind)
    expect(view.tools[0].headline).toEqual({ usd: 4.5, source: "recorded" })
    expect(view.tools[0].alsoRecordedUsd).toBeNull()
    expect(view.tools[0].methods[0].detail).toBe("Usage your agents reported to Sanction")
  })

  it("flags an admin key the provider refused", () => {
    const view = connectedTools({ ...none(), adminConnections: [{ provider: "cursor", health: "reconnect" }] })
    if (view.kind !== "tools") throw new Error(view.kind)
    expect(view.tools[0]).toMatchObject({ id: "cursor", headline: null })
    expect(view.tools[0].methods[0]).toMatchObject({ state: "attention", detail: "The provider refused the key. Reconnect it." })
  })

  it("separates recent collector reports from quiet ones", () => {
    const view = connectedTools({
      ...none(),
      collectorDeliveries: [{ source: "codex", recent: false }, { source: "claude-code", recent: true }],
    })
    if (view.kind !== "tools") throw new Error(view.kind)
    expect(ids(view)).toEqual(["claude", "codex"])
    expect(view.tools.map((t) => t.methods[0].state)).toEqual(["ok", "waiting"])
  })

  it("never shows a method that is not built, even when a key for it is stored", () => {
    const view = connectedTools({ ...none(), providerKeys: ["perplexity"] })
    expect(view.kind).toBe("empty")
  })

  it("connects a tool through its billing export and drops it from addable", () => {
    const view = connectedTools({ ...none(), billingExports: ["grok-bot"] })
    if (view.kind !== "tools") throw new Error(view.kind)
    expect(ids(view)).toEqual(["grok"])
    expect(view.tools[0].methods).toEqual([expect.objectContaining({ bucket: "billing_export", state: "ok" })])
    expect(view.addable.map((t) => t.id)).not.toContain("grok")
  })

  it("lists tools in catalog order whatever order the signals arrive in", () => {
    const view = connectedTools({
      ...none(),
      billingExports: ["cursor"],
      providerKeys: ["gemini", "anthropic"],
    })
    expect(ids(view)).toEqual(["claude", "cursor", "gemini"])
  })
})
