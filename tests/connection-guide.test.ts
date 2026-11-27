import { readFileSync } from "node:fs"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ConnectionGuide } from "@/components/connection-guide"
import { connectionHosts } from "@/lib/connectionGuideNavigation"
import { MCP_DECISION_INSTRUCTIONS } from "@/lib/mcpServer"

// Select the URL fragment without a browser; the production hook still owns
// hashchange subscriptions and the existing navigation tests cover parsing.
const location = vi.hoisted(() => ({ fragment: "" }))
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useSyncExternalStore: () => location.fragment,
}))

const source = readFileSync(new URL("../docs/CONNECT.md", import.meta.url), "utf8")

function guideSection(fragment: string) {
  location.fragment = fragment
  const html = renderToStaticMarkup(createElement(ConnectionGuide, { source }))
  return html.match(/<section[^>]*aria-label="[^"]+ connection guide"[^>]*>([\s\S]*?)<\/section>/)?.[1] ?? ""
}

beforeEach(() => { location.fragment = "" })

describe("server-rendered connection guide", () => {
  it("retains the introduction and full troubleshooting/disconnect reference before host selection", () => {
    const html = renderToStaticMarkup(createElement(ConnectionGuide, { source }))
    expect(html).toContain("Choose your AI host")
    expect(html).toContain("Connecting Sanction does not automatically")
    expect(html).toContain("Disconnect or get help")
    expect(html).toContain('href="/connect/mcp"')
    expect(html).not.toContain('aria-label="Connection steps"')
  })

  it.each(connectionHosts)("renders $name setup and evidence from the maintained guide", ({ slug, name }) => {
    const html = guideSection(`#host=${slug}&step=connect`)
    expect(html).toContain(name === "ChatGPT" ? "ChatGPT availability" : `Connect ${name}`)
    expect(html).toContain("Recorded verification and limitations")
    if (name === "ChatGPT") {
      expect(html).toContain("No verified public listing")
      expect(html).not.toContain("Copy endpoint")
      expect(html).not.toContain("Copy for your agent")
      expect(html).not.toContain('aria-label="Connection steps"')
    } else {
      expect(html).toContain("https://getsanction.com/mcp/approvals")
      expect(html).toContain("Copy endpoint")
      expect(html).toContain("Never paste")
      expect(html).toContain("Copy for your agent")
      expect(html).toContain(`Sanction setup for ${name}, step 1 of 3: connect.`)
      expect(html).toContain("Next: check the connection")
    }
  })

  it("preserves host-specific instructions and links", () => {
    expect(guideSection("#host=cursor")).toContain(".cursor/mcp.json")
    expect(guideSection("#host=codex")).toContain("codex mcp login sanction")
    expect(guideSection("#host=grok-bot")).toContain('href="/docs/grok-bot"')
  })

  it("keeps the check and request steps separate, with the exact follow-up guidance", () => {
    const check = guideSection("#host=claude&step=check")
    expect(check).toContain("sanction_wallet_status")
    expect(check).toContain("Copy for your agent")
    expect(check).toContain("step 2 of 3: check the connection.")
    expect(check).not.toContain("step 3 of 3")
    const request = guideSection("#host=claude&step=request")
    expect(request).toContain("sanction.demo.approval")
    expect(request).toContain("Copy for your agent")
    expect(request).toContain("step 3 of 3: request one test approval.")
    expect(request).toContain('href="/dashboard/approvals" target="_blank" rel="noopener noreferrer"')
    expect(request).toContain("Copy follow-up prompt")
    expect(request).toContain("Do not execute the synthetic tool or any")
    expect(request).toContain("without displaying the grant")
  })

  it("server-renders the agent block generic: no account, a sign-in prompt, the guide's own prompt and the server's rules", () => {
    const check = guideSection("#host=grok-bot&step=check")
    expect(check).toContain("Acting for: the Sanction wallet I sign in to.")
    expect(check).toContain('href="/login?next=%2Fdocs%2Fconnect"')
    expect(check).not.toContain("Filled in for")
    expect(check).toContain("Do now: Call only `sanction_wallet_status` with empty arguments.")
    const { content } = ConnectionGuide({ source }).props
    expect(content.agent.rules).toBe(MCP_DECISION_INSTRUCTIONS)
    expect(content.agent.setup["grok-bot"]).toContain("In chat, ask the Bot to add `https://getsanction.com/mcp/approvals`")
    expect(content.agent.setup.codex).toContain("codex mcp login sanction")
    expect(content.agent.setup.codex).toContain("](https://getsanction.com/docs/chatgpt-codex)")
    expect(Object.values(content.agent.setup).join()).not.toContain("](/")
  })

  it("passes complete clipboard prompts alongside rendered content", () => {
    const { content } = ConnectionGuide({ source }).props
    expect(content.endpoint).toBe("https://getsanction.com/mcp/approvals")
    expect(content.check.prompt).toContain("Call only `sanction_wallet_status` with empty arguments.")
    expect(content.request.prompt).toContain("retry, or poll automatically.")
    expect(content.redemption.prompt).toContain("original tool, server (including its omission), arguments, `require_approval`")
    expect(content.redemption.prompt).toContain("redemption returns `authorized: true` and `next_action: proceed`.")
    expect(content.redemption.prompt).not.toContain("\n> ")
  })
})
