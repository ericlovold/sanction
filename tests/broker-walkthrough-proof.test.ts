import { beforeEach, describe, expect, it, vi } from "vitest"

const { findFirst, approvalFindFirst, subtreeWalletIds } = vi.hoisted(() => ({
  findFirst: vi.fn(),
  approvalFindFirst: vi.fn(),
  subtreeWalletIds: vi.fn(),
}))
vi.mock("@/lib/db", () => ({ db: { brokerWalkthrough: { findFirst }, pendingApproval: { findFirst: approvalFindFirst } } }))
vi.mock("@/lib/walletSubtree", () => ({ subtreeWalletIds }))
vi.mock("@/app/mcp/broker/[upstream]/route", () => ({ POST: vi.fn() }))

import { completedWalkthroughProof, walkthroughView } from "../lib/brokerWalkthrough"

function successfulRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "proof",
    ownerWalletId: "owner",
    testWalletId: "child",
    state: "completed",
    completedAt: new Date("2026-01-02"),
    createdAt: new Date("2026-01-01"),
    expiresAt: new Date("2026-01-01T01:00:00Z"),
    initialStopped: true,
    changedStopped: true,
    reuseStopped: true,
    executionCount: 1,
    requestId: null,
    ...overrides,
  }
}

type Row = Record<string, unknown>
type Query = { where: Record<string, unknown>; orderBy: Record<string, "asc" | "desc">; select: Record<string, boolean> }
// Evaluate the query against fixtures so omissions in a predicate admit bad evidence.
function useRows(rows: Row[]) {
  findFirst.mockImplementation(async ({ where, orderBy, select }: Query) => {
    const matches = rows.filter(row => Object.entries(where).every(([key, predicate]) => {
      if (typeof predicate === "object" && predicate !== null) {
        if ("in" in predicate) return (predicate.in as unknown[]).includes(row[key])
        if ("not" in predicate) return row[key] !== predicate.not
        throw new Error(`Unsupported predicate: ${key}`)
      }
      return row[key] === predicate
    }))
    const [sortKey, direction] = Object.entries(orderBy)[0]
    matches.sort((a, b) => {
      const left = (a[sortKey] as Date | null)?.getTime() ?? 0
      const right = (b[sortKey] as Date | null)?.getTime() ?? 0
      return direction === "desc" ? right - left : left - right
    })
    const row = matches[0]
    return row ? Object.fromEntries(Object.entries(select).filter(([, enabled]) => enabled).map(([key]) => [key, row[key]])) : null
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  subtreeWalletIds.mockResolvedValue({ ids: ["owner", "child"], truncated: false })
})

describe("completed walkthrough proof", () => {
  it("retains an expired successful run and returns only its proof identifier and timestamp", async () => {
    useRows([successfulRun()])
    expect(await completedWalkthroughProof("owner")).toEqual({ id: "proof", completedAt: new Date("2026-01-02") })
    expect(subtreeWalletIds).toHaveBeenCalledWith("owner")
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        ownerWalletId: "owner", testWalletId: { in: ["owner", "child"] }, state: "completed",
        completedAt: { not: null }, initialStopped: true, changedStopped: true, reuseStopped: true, executionCount: 1,
      },
      orderBy: { completedAt: "desc" },
      select: { id: true, completedAt: true },
    })
  })

  it.each([
    ["incomplete state", { state: "pending" }],
    ["failed state", { state: "failed" }],
    ["missing completion timestamp", { completedAt: null }],
    ["initial call allowed", { initialStopped: false }],
    ["changed arguments allowed", { changedStopped: false }],
    ["grant reused", { reuseStopped: false }],
    ["no execution", { executionCount: 0 }],
    ["multiple executions", { executionCount: 2 }],
    ["another owner", { ownerWalletId: "other-owner" }],
    ["wallet outside current subtree", { testWalletId: "removed-child" }],
  ])("rejects %s", async (_label, overrides) => {
    useRows([successfulRun(overrides)])
    expect(await completedWalkthroughProof("owner")).toBeNull()
  })

  it("finds an older success despite a newer unfinished run", async () => {
    useRows([
      successfulRun({ id: "new-pending", createdAt: new Date("2026-03-01"), state: "pending", completedAt: null }),
      successfulRun(),
    ])
    expect(await completedWalkthroughProof("owner")).toMatchObject({ id: "proof" })
  })

  it("selects the most recently completed success", async () => {
    useRows([
      successfulRun({ id: "created-later", createdAt: new Date("2026-02-01"), completedAt: new Date("2026-02-02") }),
      successfulRun({ id: "completed-later", completedAt: new Date("2026-02-03") }),
    ])
    expect(await completedWalkthroughProof("owner")).toMatchObject({ id: "completed-later" })
  })

  it("rechecks subtree membership when a previously visible child moves", async () => {
    useRows([successfulRun()])
    expect(await completedWalkthroughProof("owner")).not.toBeNull()
    subtreeWalletIds.mockResolvedValue({ ids: ["owner"], truncated: false })
    expect(await completedWalkthroughProof("owner")).toBeNull()
  })
})

describe("exact walkthrough proof view", () => {
  it("opens the requested historical run instead of the latest run", async () => {
    useRows([successfulRun({ id: "newer", createdAt: new Date("2026-03-01") }), successfulRun()])
    expect(await walkthroughView("owner", "proof")).toMatchObject({ id: "proof", completedAt: "2026-01-02T00:00:00.000Z" })
    expect(findFirst.mock.calls[0][0].where).toEqual({ ownerWalletId: "owner", id: "proof" })
  })

  it("keeps the latest-run default", async () => {
    useRows([successfulRun(), successfulRun({ id: "newer", createdAt: new Date("2026-03-01") })])
    expect(await walkthroughView("owner")).toMatchObject({ id: "newer" })
  })

  it("does not return another owner's run or fall back for unknown ids", async () => {
    useRows([successfulRun(), successfulRun({ id: "foreign", ownerWalletId: "other-owner" })])
    expect(await walkthroughView("owner", "foreign")).toBeNull()
    expect(await walkthroughView("owner", "unknown")).toBeNull()
    expect(approvalFindFirst).not.toHaveBeenCalled()
  })

  it("rejects a requested run whose test wallet left the owner's subtree before approval lookup", async () => {
    useRows([successfulRun({ testWalletId: "removed-child", requestId: "request" })])
    expect(await walkthroughView("owner", "proof")).toBeNull()
    expect(approvalFindFirst).not.toHaveBeenCalled()
  })
})
