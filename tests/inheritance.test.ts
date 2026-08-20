import { describe, it, expect } from "vitest"
import { decideToolLayered, decideCapabilityLayered, policyLayerChain, type PolicyLayer } from "../lib/inheritance"
import { decideTool } from "../lib/toolDecisions"

// INHERIT-1: a child may tighten, never loosen. Layers are root→leaf; the
// fold is deny > escalate > allow across layers with root-most attribution.

const layer = (walletId: string, over: Partial<PolicyLayer> = {}): PolicyLayer => ({
  walletId,
  revision: 1,
  blockedTools: [],
  allowedTools: [],
  escalateTools: [],
  capabilityRules: [],
  toolConditions: [],
  ...over,
})

describe("decideToolLayered", () => {
  it("an ancestor block beats a child allow — and names the ancestor", () => {
    const out = decideToolLayered("payments.charge", [
      layer("org_root", { blockedTools: ["payments.charge"] }),
      layer("team", { allowedTools: ["payments.charge"] }),
    ])
    expect(out.effect).toBe("deny")
    expect(out.code).toBe("TOOL_BLOCKED")
    expect(out.decidedBy.walletId).toBe("org_root")
  })

  it("a child block stands under a permissive parent", () => {
    const out = decideToolLayered("shell.exec", [
      layer("org_root"), // empty lists = allow all
      layer("team", { blockedTools: ["shell.exec"] }),
    ])
    expect(out.effect).toBe("deny")
    expect(out.decidedBy.walletId).toBe("team")
  })

  it("a parent's allow-list binds the whole subtree", () => {
    const out = decideToolLayered("db.drop", [
      layer("org_root", { allowedTools: ["github.read", "github.write"] }),
      layer("team", { allowedTools: ["db.drop"] }), // child tries to widen
    ])
    expect(out.effect).toBe("deny")
    expect(out.code).toBe("TOOL_NOT_ALLOWED")
    expect(out.decidedBy.walletId).toBe("org_root")
  })

  it("a parent cannot widen a child's allow-list either", () => {
    const out = decideToolLayered("db.drop", [
      layer("org_root"), // allow-all parent
      layer("team", { allowedTools: ["github.read"] }),
    ])
    expect(out.effect).toBe("deny")
    expect(out.decidedBy.walletId).toBe("team")
  })

  it("an ancestor escalate stands when every layer allows otherwise", () => {
    const out = decideToolLayered("deploy.prod", [
      layer("org_root", { escalateTools: ["deploy.prod"] }),
      layer("team"),
    ])
    expect(out.effect).toBe("escalate")
    expect(out.code).toBe("TOOL_ESCALATION_REQUIRED")
    expect(out.decidedBy.walletId).toBe("org_root")
  })

  it("deny beats escalate across layers, regardless of depth order", () => {
    const out = decideToolLayered("x", [
      layer("org_root", { escalateTools: ["x"] }),
      layer("team", { blockedTools: ["x"] }),
    ])
    expect(out.effect).toBe("deny")
    expect(out.decidedBy.walletId).toBe("team")
  })

  it("all layers allow → the leaf's own verdict, with the full consulted trail", () => {
    const out = decideToolLayered("github.read", [
      layer("org_root", { revision: 7 }),
      layer("team", { revision: 3, allowedTools: ["github.read"] }),
    ])
    expect(out.effect).toBe("allow")
    expect(out.decidedBy.walletId).toBe("team")
    expect(out.consulted).toEqual([
      { wallet_id: "org_root", revision: 7 },
      { wallet_id: "team", revision: 3 },
    ])
  })

  it("a single layer is exactly today's decideTool", () => {
    const lists = { blockedTools: ["a"], allowedTools: [], escalateTools: ["b"] }
    for (const tool of ["a", "b", "c"]) {
      const layered = decideToolLayered(tool, [layer("solo", lists)])
      const flat = decideTool({ tool, ...lists })
      const status = layered.effect === "allow" ? "allowed" : layered.effect === "escalate" ? "escalated" : "denied"
      expect(status).toBe(flat.status)
      expect(layered.code).toBe(flat.code)
    }
  })
})

describe("decideCapabilityLayered", () => {
  it("a permissive ancestor cannot widen a child's strict allow-list", () => {
    // The exact failure a naive rule-list concat would cause: the parent's
    // `allow *` would satisfy the child's mention check for everything.
    const out = decideCapabilityLayered("api:payments.example/charge", [
      layer("org_root", { capabilityRules: [{ pattern: "*", effect: "allow" }] }),
      layer("team", { capabilityRules: [{ pattern: "api:github.com/*", effect: "allow" }] }),
    ])
    expect(out.effect).toBe("deny")
    expect(out.code).toBe("CAPABILITY_NOT_ALLOWED")
    expect(out.decidedBy.walletId).toBe("team")
  })

  it("an ancestor block beats a child allow", () => {
    const out = decideCapabilityLayered("skill:install:web-scraper", [
      layer("org_root", { capabilityRules: [{ pattern: "skill:install:*", effect: "block" }] }),
      layer("team", { capabilityRules: [{ pattern: "skill:install:web-scraper", effect: "allow" }] }),
    ])
    expect(out.effect).toBe("deny")
    expect(out.code).toBe("CAPABILITY_BLOCKED")
    expect(out.decidedBy.walletId).toBe("org_root")
  })

  it("an ancestor escalate survives a child allow", () => {
    const out = decideCapabilityLayered("api:aws.amazon.com/ec2", [
      layer("org_root", { capabilityRules: [{ pattern: "api:aws.amazon.com/*", effect: "escalate" }] }),
      layer("team", { capabilityRules: [{ pattern: "api:aws.amazon.com/ec2", effect: "allow" }] }),
    ])
    expect(out.effect).toBe("escalate")
    expect(out.decidedBy.walletId).toBe("org_root")
  })
})

describe("policyLayerChain", () => {
  const leafPolicy = { currentRevision: 2, blockedTools: [] as string[], allowedTools: [] as string[], escalateTools: [] as string[], capabilityRules: [] as unknown[] }

  it("a parentless wallet costs zero queries and yields one layer", async () => {
    const tx = { wallet: { findUnique: async () => { throw new Error("must not query") } } }
    const layers = await policyLayerChain(tx as never, { id: "solo", parentId: null, policy: leafPolicy })
    expect(layers).toHaveLength(1)
    expect(layers[0].walletId).toBe("solo")
  })

  it("walks ancestors root→leaf, skipping wallets without a policy", async () => {
    const wallets: Record<string, { id: string; parentId: string | null; policy: typeof leafPolicy | null }> = {
      mid: { id: "mid", parentId: "root", policy: null }, // no policy = no layer
      root: { id: "root", parentId: null, policy: { ...leafPolicy, currentRevision: 9, blockedTools: ["x"] } },
    }
    const tx = { wallet: { findUnique: async ({ where }: { where: { id: string } }) => wallets[where.id] ?? null } }
    const layers = await policyLayerChain(tx as never, { id: "leaf", parentId: "mid", policy: leafPolicy })
    expect(layers.map((l) => l.walletId)).toEqual(["root", "leaf"])
    expect(layers[0].revision).toBe(9)
  })

  it("a parent cycle terminates instead of looping", async () => {
    const wallets: Record<string, { id: string; parentId: string | null; policy: typeof leafPolicy }> = {
      a: { id: "a", parentId: "b", policy: leafPolicy },
      b: { id: "b", parentId: "a", policy: leafPolicy },
    }
    const tx = { wallet: { findUnique: async ({ where }: { where: { id: string } }) => wallets[where.id] ?? null } }
    const layers = await policyLayerChain(tx as never, { id: "leaf", parentId: "a", policy: leafPolicy })
    expect(layers.map((l) => l.walletId)).toEqual(["b", "a", "leaf"])
  })
})
