import { readFileSync } from "node:fs"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { WalletRole } from "@/lib/roles"
import { safeNext } from "@/lib/returnPath"

const fixture = vi.hoisted(() => ({
  wallet: vi.fn(),
  state: { ok: false, error: "" } as Record<string, unknown>,
  key: "pxy_test_" + "a".repeat(64),
}))
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useActionState: () => [fixture.state, vi.fn(), false],
}))
vi.mock("@/lib/session", () => ({ getViewWallet: fixture.wallet }))
vi.mock("@/app/dashboard/actions", () => ({ createAgentAction: vi.fn() }))
vi.mock("@/app/dashboard/approvals/actions", () => ({ sendTestEscalationAction: vi.fn() }))
vi.mock("@vercel/analytics", () => ({ track: vi.fn() }))
import ClaudeCodeConnectPage from "@/app/dashboard/connect/claude-code/page"
import { ClaudeCodeSeat } from "@/components/claude-code-seat"
import { CLAUDE_CODE_CONFIGURE_CHECK, CLAUDE_CODE_GATED, CLAUDE_CODE_INSTALL } from "@/lib/claudeCodePlugin"

const wallet = (role: WalletRole, isSession = true) => ({ id: "wallet", name: "Personal", role, isSession })
const page = async () => renderToStaticMarkup(await ClaudeCodeConnectPage())
const seat = () => renderToStaticMarkup(createElement(ClaudeCodeSeat))

beforeEach(() => {
  vi.resetAllMocks()
  fixture.state = { ok: false, error: "" }
})

describe("Claude Code seat page", () => {
  it.each([null, wallet("viewer", false)])("sends a visitor without a session to sign in and back", async (view) => {
    fixture.wallet.mockResolvedValue(view)
    const html = await page()
    const next = new URL(html.match(/href="(\/login\?next=[^"]+)"/)![1], "https://x.test").searchParams.get("next")
    expect(next).toBe("/dashboard/connect/claude-code")
    expect(safeNext(next)).toBe(next)
    expect(html).not.toContain("Create seat")
  })

  it("does not offer seat creation to a viewer", async () => {
    fixture.wallet.mockResolvedValue(wallet("viewer"))
    const html = await page()
    expect(html).toContain("Ask a wallet admin")
    expect(html).not.toContain("Create seat")
  })

  it("offers seat creation to an admin and states the limits", async () => {
    fixture.wallet.mockResolvedValue(wallet("admin"))
    const html = await page()
    expect(html).toContain("Create seat and show key")
    expect(html).toContain("Not a sandbox")
    expect(html).toContain("does not prove the command ran")
    for (const command of CLAUDE_CODE_GATED) expect(html).toContain(`<code>${command}</code>`)
  })

  it("names exactly the commands the plugin's hook gates", () => {
    const hook = readFileSync(new URL("../claude-plugin/hooks/claude-hook.mjs", import.meta.url), "utf8")
    const list = hook.match(/const gatedPrefixes = \[([^\]]*)\]/)?.[1]
    expect(list).toBeDefined()
    expect([...list!.matchAll(/"([^"]+)"/g)].map(match => match[1])).toEqual([...CLAUDE_CODE_GATED])
  })
})

describe("Claude Code seat steps", () => {
  it("starts with only the seat form, default name filled in", () => {
    const html = seat()
    expect(html).toMatch(/<input[^>]*name="name"[^>]*value="Claude Code"/)
    expect(html).not.toContain("pxy_")
    expect(html).not.toContain(CLAUDE_CODE_INSTALL[0])
  })

  it("shows a creation error and keeps the form", () => {
    fixture.state = { ok: false, error: "Log in to create agents." }
    const html = seat()
    expect(html).toMatch(/role="alert"[^>]*>Log in to create agents\./)
    expect(html).toContain("Create seat and show key")
  })

  it("shows the key once with the install commands and a test bound to the new seat", () => {
    fixture.state = { ok: true, error: "", agentKey: fixture.key, agentName: "Claude Code", agentId: "agent_cc" }
    const html = seat()
    expect(html.split(fixture.key).length - 1).toBe(1)
    expect(html).toContain("shown once")
    for (const command of [...CLAUDE_CODE_INSTALL, CLAUDE_CODE_CONFIGURE_CHECK]) expect(html).toContain(`value="${command}"`)
    // The merged plugin takes the key through /plugin, not a prompt on enable.
    expect(html).toMatch(/<code>\/plugin<\/code>.*<strong>Installed<\/strong>.*<strong>Configure<\/strong>/)
    expect(html).not.toContain("When Claude Code asks")
    expect(html).toMatch(/<input type="hidden" name="agent_id" value="agent_cc"/)
    // After creation the form is gone, so the key cannot be replaced by a resubmit.
    expect(html).not.toContain("Create seat and show key")
    expect(html).toContain("does not run Claude Code or prove the plugin is installed")
  })
})
