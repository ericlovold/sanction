import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"

// Admin ideas moderation: fails closed without the secret, constant-time-gated,
// and PATCH covers publish/status/delete plus the empty-update guard.

const { dbMock } = vi.hoisted(() => ({
  dbMock: { idea: { findMany: vi.fn(), update: vi.fn(), delete: vi.fn() } },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))

import { GET as listIdeas, PATCH as patchIdea } from "../app/api/admin/ideas/route"

const SECRET = "test-admin-secret"
const CUID = "cjld2cjxh0000qzrmn831i7rn"

function get(headers: Record<string, string> = { "x-admin-secret": SECRET }) {
  return new NextRequest("https://test.local/api/admin/ideas", { headers })
}

function patch(body: unknown, headers: Record<string, string> = { "x-admin-secret": SECRET }) {
  return new NextRequest("https://test.local/api/admin/ideas", {
    method: "PATCH",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("SANCTION_ADMIN_SECRET", SECRET)
})
afterEach(() => vi.unstubAllEnvs())

describe("admin ideas — auth gate", () => {
  it("503s (disabled) when SANCTION_ADMIN_SECRET is not configured", async () => {
    vi.stubEnv("SANCTION_ADMIN_SECRET", "")
    expect((await listIdeas(get())).status).toBe(503)
    expect((await patchIdea(patch({ id: CUID, isPublished: true }))).status).toBe(503)
  })

  it("401s on a wrong or missing secret, and reads nothing", async () => {
    expect((await listIdeas(get({ "x-admin-secret": "nope" }))).status).toBe(401)
    expect((await listIdeas(get({}))).status).toBe(401)
    expect(dbMock.idea.findMany).not.toHaveBeenCalled()
  })
})

describe("GET /api/admin/ideas", () => {
  it("returns the full moderation queue, unpublished first, no-store", async () => {
    const ideas = [
      { id: "a", isPublished: false, voteCount: 3 },
      { id: "b", isPublished: true, voteCount: 9 },
    ]
    dbMock.idea.findMany.mockResolvedValue(ideas)

    const res = await listIdeas(get())

    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(await res.json()).toEqual({ count: 2, ideas })
    expect(dbMock.idea.findMany).toHaveBeenCalledWith({
      orderBy: [{ isPublished: "asc" }, { voteCount: "desc" }, { createdAt: "desc" }],
    })
  })
})

describe("PATCH /api/admin/ideas", () => {
  it("400s on a malformed body or non-cuid id", async () => {
    expect((await patchIdea(patch(null))).status).toBe(400)
    expect((await patchIdea(patch({ id: "not-a-cuid", isPublished: true }))).status).toBe(400)
  })

  it("400s when there is nothing to update", async () => {
    const res = await patchIdea(patch({ id: CUID }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "Nothing to update" })
    expect(dbMock.idea.update).not.toHaveBeenCalled()
  })

  it("publishes and sets status in one write", async () => {
    dbMock.idea.update.mockResolvedValue({ id: CUID, isPublished: true, status: "planned" })

    const res = await patchIdea(patch({ id: CUID, isPublished: true, status: "planned" }))

    expect(res.status).toBe(200)
    expect(dbMock.idea.update).toHaveBeenCalledWith({
      where: { id: CUID },
      data: { isPublished: true, status: "planned" },
    })
  })

  it("rejects an unknown status", async () => {
    expect((await patchIdea(patch({ id: CUID, status: "someday" }))).status).toBe(400)
  })

  it("delete wins over other fields and reports the id", async () => {
    dbMock.idea.delete.mockResolvedValue({ id: CUID })

    const res = await patchIdea(patch({ id: CUID, delete: true, isPublished: true }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, deleted: CUID })
    expect(dbMock.idea.delete).toHaveBeenCalledWith({ where: { id: CUID } })
    expect(dbMock.idea.update).not.toHaveBeenCalled()
  })
})
