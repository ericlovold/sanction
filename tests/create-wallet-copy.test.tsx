import { createElement, isValidElement, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const fixture = vi.hoisted(() => ({
  status: "idle",
  copying: { current: false },
  setStatus: vi.fn(),
  result: {
    ok: true,
    agentKey: "pxy_test_agent_key_" + "a".repeat(64),
    managementKey: "sk_test_management_key_" + "b".repeat(64),
    walletId: "test-wallet",
  },
}))
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useActionState: () => [fixture.result, vi.fn(), false],
  useState: () => [fixture.status, fixture.setStatus],
  useRef: () => fixture.copying,
}))
vi.mock("@/app/start/actions", () => ({ createWalletAction: vi.fn() }))
vi.mock("@/components/connect-app", () => ({ ConnectApp: () => null }))
import { CreateWallet } from "../components/create-wallet"

// Exercise the actual rendered Copy callback without adding a DOM dependency.
function find(node: ReactNode, predicate: (element: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = find(child, predicate)
      if (found) return found
    }
  }
  if (!isValidElement<Record<string, unknown>>(node)) return
  if (predicate(node)) return node
  return find(node.props.children as ReactNode, predicate)
}

function copyButton() {
  const element = find(CreateWallet({}), (node) => node.props.label === "curl command")!
  const Copy = element.type as (props: Record<string, unknown>) => ReactNode
  return find(Copy(element.props), (node) => node.type === "button")!
}

beforeEach(() => {
  fixture.status = "idle"
  fixture.copying.current = false
  fixture.setStatus.mockReset()
})
afterEach(() => vi.unstubAllGlobals())

describe("signup copy feedback", () => {
  it("reports success only after the write resolves and ignores repeated pending clicks", async () => {
    let resolve!: () => void
    const writeText = vi.fn(() => new Promise<void>((done) => { resolve = done }))
    vi.stubGlobal("navigator", { clipboard: { writeText } })
    const click = copyButton().props.onClick as () => Promise<void>
    const pending = click()
    await click()
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText.mock.calls[0]).toEqual([expect.stringContaining(fixture.result.agentKey)])
    expect(fixture.setStatus.mock.calls).toEqual([["pending"]])
    resolve()
    await pending
    expect(fixture.setStatus.mock.calls).toEqual([["pending"], ["copied"]])
    expect(fixture.copying.current).toBe(false)
  })

  it.each(["rejected", "unavailable", "throws"])("handles %s clipboard access without a false success and allows retry", async (mode) => {
    const writeText = vi.fn(() => mode === "throws"
      ? (() => { throw new Error("private browser details") })()
      : Promise.reject(new Error("private browser details")))
    const clipboard = mode === "unavailable" ? undefined : { writeText }
    vi.stubGlobal("navigator", { clipboard })
    const click = copyButton().props.onClick as () => Promise<void>
    await click()
    expect(fixture.setStatus.mock.calls).toEqual([["pending"], ["failed"]])
    expect(fixture.copying.current).toBe(false)
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
    await click()
    expect(fixture.setStatus).toHaveBeenLastCalledWith("copied")
  })

  it("disables copying while pending and names the copied content", () => {
    fixture.status = "pending"
    const button = copyButton()
    expect(button.props.disabled).toBe(true)
    expect(button.props["aria-label"]).toBe("Copy curl command")
    expect(button.props.children).toBe("copying…")
  })

  it("renders complete readonly keys, manual fallback guidance, and live failure feedback", () => {
    fixture.status = "failed"
    const html = renderToStaticMarkup(createElement(CreateWallet))
    expect(html).toContain(`value="${fixture.result.agentKey}"`)
    expect(html).toContain(`value="${fixture.result.managementKey}"`)
    expect(html.match(/readOnly=""/g)).toHaveLength(3)
    expect(html).toContain("Copy Agent key")
    expect(html).toContain("Copy Management key")
    expect(html).toContain('role="status"')
    expect(html).toContain("Copy failed. Select the text and copy it manually.")
    expect(html).not.toContain("private browser details")
    expect(html).not.toContain("truncate")
  })
})
