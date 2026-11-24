import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { dbMock, viewMock, rosterMock } = vi.hoisted(() => ({
  dbMock: {
    policy: { updateMany: vi.fn(), findUnique: vi.fn() },
    brokerWalkthrough: { findFirst: vi.fn() },
    slackInstall: { count: vi.fn() },
    webhook: { count: vi.fn() },
    authorizationRequest: { count: vi.fn() },
    tokenLog: { count: vi.fn() },
  },
  viewMock: vi.fn(),
  rosterMock: vi.fn(),
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("@/lib/homeOverview", () => ({ homeOverview: vi.fn(async () => ({ providers: [], otherSpend: null, spendUnavailable: false, tools: [] })) }))
vi.mock("@/lib/session", () => ({ getViewWallet: viewMock }))
vi.mock("@/lib/roster", () => ({ getRoster: rosterMock, getWaiting: vi.fn(async () => []) }))
vi.mock("@/lib/rls", () => ({ withTenant: (_id: string, fn: (tx: typeof dbMock) => unknown) => fn(dbMock) }))
vi.mock("@/lib/firstHourConnection", () => ({ hasActiveMcpConnection: vi.fn(async () => false) }))
vi.mock("@/components/roster-add-agent", () => ({ RosterAddAgent: () => null }))
vi.mock("@/components/setup-continuation", () => ({ SetupContinuation: () => null }))
vi.mock("../app/dashboard/onboarding-tour", () => ({ OnboardingTour: () => null, TourLauncher: () => null }))

import Dashboard from "../app/dashboard/page"

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("SANCTION_WALLET_ID", "demo-wallet")
  viewMock.mockResolvedValue({ id: "demo-wallet", name: "Demo", isSession: false, role: "viewer" })
  rosterMock.mockResolvedValue({ agentCount: 0, pendingTotal: 0, root: { id: "demo-wallet", name: "Demo", children: [], agents: [], monthUsd: 0, pending: 0, spendCapUsd: 1234 } })
  dbMock.brokerWalkthrough.findFirst.mockResolvedValue(null)
  dbMock.policy.findUnique.mockResolvedValue(null)
  for (const table of [dbMock.slackInstall, dbMock.webhook, dbMock.authorizationRequest, dbMock.tokenLog]) table.count.mockResolvedValue(0)
})
afterEach(() => vi.unstubAllEnvs())

describe("dashboard reads do not repair or overwrite policy", () => {
  it("renders repeated demo visits without policy writes, including missing policy", async () => {
    // Previously this branch issued UPDATE on every GET and overwrote the
    // monthly spend cap whenever monthlyTokenBudgetUsd was null.
    expect(await Dashboard()).toBeTruthy()
    expect(await Dashboard()).toBeTruthy()
    expect(dbMock.policy.updateMany).not.toHaveBeenCalled()
    expect(rosterMock).toHaveBeenCalledWith("demo-wallet", expect.any(Date))
  })

  it("does not query or write policy when there is no wallet to show", async () => {
    viewMock.mockResolvedValue(null)
    expect(await Dashboard()).toBeTruthy()
    expect(dbMock.policy.findUnique).not.toHaveBeenCalled()
    expect(dbMock.policy.updateMany).not.toHaveBeenCalled()
  })
})
