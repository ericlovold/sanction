import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { NextRequest } from "next/server"
import { MCP_WALLET_TOOLS, walletCard } from "../lib/walletCard"
import { GET as walletCardGet } from "../app/.well-known/wallet-card.json/route"

describe("walletCard", () => {
  it("is an agent-wallet discovery document with carry, present, and verify", () => {
    const card = walletCard("https://getsanction.com")
    expect(card.type).toBe("agent-wallet")
    expect(card.carry.mcp_stdio.command).toBe("npx")
    expect(card.carry.mcp_stdio.args).toEqual(["sanction-mcp"])
    expect(card.carry.mcp_remote).toBe("https://getsanction.com/mcp")
    expect(card.present.format).toBe("execution-jwt")
    expect(card.present.mandate).toBe("https://getsanction.com/api/v1/exec")
    expect(card.verify.mandate).toBe("https://getsanction.com/api/v1/mandate/verify")
    expect(card.evidence.export).toBe("https://getsanction.com/api/v1/audit/export")
    expect(card.evidence.verify).toBe("https://getsanction.com/api/v1/audit/verify")
    expect(card.tools.map((t) => t.name)).toEqual(MCP_WALLET_TOOLS.map((t) => t.name))
    expect(card.tools).toHaveLength(10)
  })

  it("states cooperative enforcement instead of claiming interception", () => {
    const card = walletCard("https://example.test")
    expect(card.honesty.enforcement).toBe("cooperative")
    expect(card.honesty.interception).toBe("llm-gateway-only")
    expect(card.honesty.note).toMatch(/do not claim a hijacked agent cannot spend/i)
  })
})

describe("GET /.well-known/wallet-card.json", () => {
  it("serves the card for the request origin, cacheable, with no secrets", async () => {
    const req = new NextRequest("https://preview.example/.well-known/wallet-card.json")
    const res = await walletCardGet(req)
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toMatch(/max-age=3600/)
    const body = await res.json()
    expect(body.type).toBe("agent-wallet")
    expect(body.verify.mandate).toBe("https://preview.example/api/v1/mandate/verify")
    expect(JSON.stringify(body)).not.toMatch(/pxy_|sk_|SANCTION_SIGNING/)
  })
})

describe("public/.well-known/mcp.json", () => {
  it("lists the same ten tools as the Wallet Card", () => {
    const listed = JSON.parse(readFileSync("public/.well-known/mcp.json", "utf8")) as {
      version: string
      url: string
      tools: { name: string }[]
    }
    expect(listed.version).toBe("0.7.0")
    expect(listed.url).toBe("https://getsanction.com/mcp")
    expect(listed.tools.map((t) => t.name)).toEqual(MCP_WALLET_TOOLS.map((t) => t.name))
  })
})
