import { beforeEach, describe, expect, it, vi } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
const m = vi.hoisted(() => ({
  view: vi.fn(), wallets: vi.fn(), subtree: vi.fn(), pending: vi.fn(), focus: vi.fn(), org: vi.fn(), count: vi.fn(), agent: vi.fn(),
  wallet: vi.fn(), aggregate: vi.fn(),
}))
vi.mock("@/lib/session", () => ({ getViewWallet: m.view, listSessionWallets: m.wallets }))
vi.mock("@/lib/walletSubtree", () => ({ subtreeWalletIds: m.subtree }))
vi.mock("@/lib/approvals", () => ({ listPendingApprovals: m.pending }))
vi.mock("@/lib/rls", () => ({ withTenant: async () => [] }))
vi.mock("@/lib/slackOAuth", () => ({ slackClientId: () => null }))
vi.mock("@/lib/decisionMeter", () => ({ decisionsThisMonth: async () => 0 }))
vi.mock("@/app/dashboard/actions", () => ({ switchWalletAction: vi.fn() }))
vi.mock("next/navigation", () => ({ redirect: (p: string) => { throw Error(`REDIRECT:${p}`) } }))
vi.mock("@/lib/db", () => ({ db: {
  brokerWalkthrough: { findFirst: async () => null },
  pendingApproval: { findMany: m.org, findFirst: m.focus, count: m.count },
  webhook: { findMany: async () => [] },
  wallet: { findUnique: m.wallet },
  agent: { count: async () => 1, findFirst: m.agent, findMany: async () => [] },
  tokenLog: { aggregate: m.aggregate, findMany: async () => [], groupBy: async () => [] },
  authorizationRequest: { aggregate: m.aggregate, findMany: async () => [], groupBy: async () => [] },
} }))
vi.mock("@/components/approval-queue", () => ({ ApprovalQueue: ({ pending }: { pending: { id: string }[] }) => createElement("div", {}, pending.map(a => createElement("button", { key: a.id }, a.id))) }))
vi.mock("@/components/test-escalation", () => ({ TestEscalationControl: () => null }))
vi.mock("@/components/webhook-settings", () => ({ WebhookSettings: () => null }))
vi.mock("@/components/outcomes-section", () => ({ OutcomesSection: () => null }))
vi.mock("@/components/runway-chart", () => ({ RunwayChart: () => null }))
import ApprovalsPage from "../app/dashboard/approvals/page"
import SpendPage from "../app/dashboard/spend/page"
const row = (id: string) => ({ id, sourceId: `request-${id}`, sourceType: "authorization_request", walletId: "child", wallet: { id: "child", name: "Engineering" }, agent: { name: "ci-agent" }, actionType: "tool.invoke", subjectJson: {}, resourceJson: { tool: "demo.run" }, constraintsJson: {}, reason: "Review", code: "ESCALATION_REQUIRED", status: "pending", createdAt: new Date(), expiresAt: null, resolvedAt: null, resolutionNote: null, grants: [] })
beforeEach(() => {
  vi.clearAllMocks()
  m.view.mockResolvedValue({ id: "root", name: "HQ", isSession: true, role: "owner" })
  m.wallets.mockResolvedValue([]); m.subtree.mockResolvedValue({ ids: ["root", "child"] })
  m.pending.mockResolvedValue([]); m.org.mockImplementation(({ where }) => Promise.resolve(where.status === "pending" ? Array.from({ length: 50 }, (_, i) => row(`old-${i}`)) : []))
  m.count.mockResolvedValue(65); m.focus.mockResolvedValue(row("newest"))
  m.agent.mockResolvedValue(null); m.wallet.mockResolvedValue({ name: "Engineering", policy: { dailyTokenBudgetUsd: 2000, dailySpendBudgetUsd: 5000 } })
  m.aggregate.mockResolvedValue({ _sum: { costUsd: 19, amountUsd: 0, tokensIn: 0, tokensOut: 0 } })
})
describe("approval email landing", () => {
  it("renders a linked request beyond the oldest 50 and exposes the total and next page", async () => {
    const html = renderToStaticMarkup(await ApprovalsPage({ searchParams: Promise.resolve({ review: "request-newest" }) }))
    expect(html).toContain("<button>newest</button>")
    expect(html).toContain("Showing 51 of 65")
    expect(html).toContain("Next page")
    expect(m.focus).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ walletId: { in: ["root", "child"] } }) }))
  })
  it("paginates descendant approvals without dropping the review destination", async () => {
    const html = renderToStaticMarkup(await ApprovalsPage({ searchParams: Promise.resolve({ page: "2", review: "request-newest" }) }))
    expect(m.org).toHaveBeenCalledWith(expect.objectContaining({ skip: 50, take: 50 }))
    expect(html).toContain("page=1&amp;review=request-newest")
  })
  it("does not expose an inaccessible target or its decision controls", async () => {
    m.focus.mockResolvedValue(null)
    const html = renderToStaticMarkup(await ApprovalsPage({ searchParams: Promise.resolve({ review: "foreign" }) }))
    expect(html).toContain("Switch wallets")
    expect(html).not.toContain("<button>old-")
  })
  it.each(["consumed", "active", "expired"])("does not claim execution for an approved %s grant", async status => {
    m.focus.mockResolvedValue({ ...row("target"), wallet: { id: "root", name: "HQ" }, status: "approved", grants: [{ status, expiresAt: new Date(Date.now() + 60000) }] })
    const html = renderToStaticMarkup(await ApprovalsPage({ searchParams: Promise.resolve({ review: "target" }) }))
    expect(html).not.toContain("completed the action")
    expect(html).toContain(status === "consumed" ? "Execution and its outcome are not confirmed" : `grant is ${status}`)
  })
  it("does not claim executor acknowledgment after a human rejection", async () => {
    m.focus.mockResolvedValue({ ...row("target"), wallet: { id: "root", name: "HQ" }, status: "denied" })
    const html = renderToStaticMarkup(await ApprovalsPage({ searchParams: Promise.resolve({ review: "target" }) }))
    expect(html).toContain("does not confirm whether the agent received or followed")
    expect(html).not.toContain("stood down")
  })
})
describe("budget email landing", () => {
  const params = { wallet: "child", agent: "agent-1", budget: "daily_tokens" }
  it("preserves wallet, agent and budget when sign-in is required, including public demo sessions", async () => {
    m.view.mockResolvedValue({ id: "demo", isSession: false })
    await expect(SpendPage({ searchParams: Promise.resolve(params) })).rejects.toThrow(`REDIRECT:/login?next=${encodeURIComponent('/dashboard/spend?wallet=child&agent=agent-1&budget=daily_tokens')}`)
    expect(m.wallet).not.toHaveBeenCalled()
  })
  it("interrupts the wrong wallet before reading its budget or looking up the foreign agent", async () => {
    m.subtree.mockResolvedValue({ ids: ["root"] })
    const html = renderToStaticMarkup(await SpendPage({ searchParams: Promise.resolve(params) }))
    expect(html).toContain("Switch wallets to review this budget")
    expect(html).toContain("wallet%3Dchild%26agent%3Dagent-1%26budget%3Ddaily_tokens")
    expect(m.wallet).not.toHaveBeenCalled(); expect(m.agent).not.toHaveBeenCalled()
  })
  it("renders the authorized descendant and the named agent's override, not the current wallet", async () => {
    m.agent.mockResolvedValue({ id: "agent-1", name: "CI", dailyTokenBudgetUsd: 1000 })
    const html = renderToStaticMarkup(await SpendPage({ searchParams: Promise.resolve(params) }))
    expect(m.wallet).toHaveBeenCalledWith({ where: { id: "child" }, include: { policy: true } })
    expect(m.agent).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "agent-1", walletId: "child" } }))
    expect(html).toContain("Budget review · Engineering")
    expect(html).toContain("CI · today"); expect(html).toContain("$10.00")
    expect(html).not.toContain('href="/dashboard/policy"')
  })
  it("does not substitute another agent when the linked agent is absent", async () => {
    const html = renderToStaticMarkup(await SpendPage({ searchParams: Promise.resolve(params) }))
    expect(html).toContain("linked agent was not found")
    expect(m.wallet).not.toHaveBeenCalled()
  })
})
