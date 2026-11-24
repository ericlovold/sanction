import { createElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

const { db, agents, pendingGroup } = vi.hoisted(() => ({
  agents: vi.fn(),
  pendingGroup: vi.fn(),
  db: {
    $queryRaw: vi.fn(), wallet: { findMany: vi.fn() },
    grant: { groupBy: vi.fn() }, authorizationRequest: { groupBy: vi.fn() },
  },
}))
vi.mock("@/lib/db", () => ({ db: { ...db, pendingApproval: { groupBy: pendingGroup } } }))
vi.mock("@/lib/rls", () => ({ withTenant: (_ids: string[], read: (tx: unknown) => unknown) => read({ agent: { findMany: agents } }) }))
vi.mock("@/lib/session", () => ({ getViewWallet: async () => ({ id: "root", role: "admin", isSession: true }) }))
vi.mock("@/lib/seatActivity", () => ({ readSeatActivity: async () => [] }))
vi.mock("@/components/agent-creator", () => ({ AgentCreator: () => null }))
vi.mock("@/components/execution-tokens-section", () => ({ ExecutionTokensSection: () => null }))
vi.mock("@/components/agents-header", () => ({ AgentsHeader: ({ summary }: { summary: string }) => createElement("p", null, summary) }))
vi.mock("@/components/api-keys-table", () => ({ ApiKeysTable: ({ agents }: { agents: { name: string; pendingApprovals: number }[] }) =>
  createElement("div", null, agents.map((a) => createElement("span", { key: a.name }, `${a.name}: ${a.pendingApprovals} waiting`))) }))
vi.mock("next/link", () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => createElement("a", { href }, children) }))

import AgentsPage from "@/app/dashboard/agents/page"

const now = new Date("2026-11-24T12:00:00Z")
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(now)
  db.$queryRaw.mockResolvedValue([{ id: "root" }, { id: "child" }])
  db.wallet.findMany.mockResolvedValue([{ id: "root", name: "Root" }, { id: "child", name: "Child" }])
  db.grant.groupBy.mockResolvedValue([])
  db.authorizationRequest.groupBy.mockResolvedValue([])
  agents.mockResolvedValue([
    { id: "a", name: "Enabled", isActive: true, expiresAt: null },
    { id: "b", name: "Expired", isActive: true, expiresAt: now },
    { id: "c", name: "Disabled expired", isActive: false, expiresAt: now },
  ].map((a) => ({ ...a, walletId: "root", createdAt: now })))
  pendingGroup.mockImplementation(async ({ where }) => {
    const rows = [
      { agentId: "a", walletId: "root", status: "pending", expiresAt: null },
      { agentId: "a", walletId: "root", status: "pending", expiresAt: now },
      { agentId: "a", walletId: "root", status: "pending", expiresAt: new Date(now.getTime() - 1) },
      { agentId: "a", walletId: "root", status: "pending", expiresAt: new Date(now.getTime() + 1) },
      { agentId: "a", walletId: "outside", status: "pending", expiresAt: null },
    ]
    const count = rows.filter((row) => where.walletId.in.includes(row.walletId) && row.status === where.status &&
      (!where.OR || where.OR.some((clause: { expiresAt: null | { gt: Date } }) => clause.expiresAt === null
        ? row.expiresAt === null
        : row.expiresAt !== null && row.expiresAt > clause.expiresAt.gt))).length
    return [{ agentId: "a", _count: count }]
  })
})
afterEach(() => vi.useRealTimers())

it("shows actionable pending requests and disjoint effective agent totals", async () => {
  const html = renderToStaticMarkup(await AgentsPage({}))
  expect(html).toContain("1 active, 2 off or expired. 2 waiting on you.")
  expect(html).toContain("Enabled: 2 waiting")
  expect(html).not.toContain("4 waiting")
  expect(pendingGroup.mock.lastCall?.[0].where.walletId).toEqual({ in: ["root", "child"] })
})

it("keeps a disabled expired agent only in the Off filter", async () => {
  const off = renderToStaticMarkup(await AgentsPage({ searchParams: Promise.resolve({ state: "inactive" }) }))
  expect(off).toContain("Disabled expired: 0 waiting")
  const expired = renderToStaticMarkup(await AgentsPage({ searchParams: Promise.resolve({ state: "expired" }) }))
  expect(expired).toContain("Expired: 0 waiting")
  expect(expired).not.toContain("Disabled expired:")
})
