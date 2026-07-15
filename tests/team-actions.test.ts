import { describe, it, expect, vi, beforeEach } from "vitest"

// Team management (WALLET-MEMBERS) — every mutation here is owner-only;
// these tests exist specifically to prove an admin/viewer session can't
// invite, promote, or revoke, and that inviting is rate-limited like the
// other unauthenticated-adjacent send paths (magic link, escalation email).
const { dbMock, sessionMock, revalidateMock, emailMock, rateLimitMock } = vi.hoisted(() => ({
  dbMock: {
    walletMember: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn((_args: { data: Record<string, unknown> }) => undefined),
      update: vi.fn((_args: { where: Record<string, unknown>; data: Record<string, unknown> }) => undefined),
    },
  },
  sessionMock: { getSessionMember: vi.fn() },
  revalidateMock: vi.fn(),
  emailMock: { sendInviteEmail: vi.fn(async (_to: string, _i: Record<string, unknown>) => {}) },
  rateLimitMock: vi.fn(async () => ({ ok: true, retryAfter: undefined as number | undefined, limit: 20 })),
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("@/lib/session", () => sessionMock)
vi.mock("@/lib/email", () => emailMock)
vi.mock("@/lib/rateLimit", () => ({ rateLimit: rateLimitMock, ipFromHeaders: () => "1.2.3.4" }))
vi.mock("next/headers", () => ({ headers: async () => new Headers([["host", "getsanction.com"]]) }))
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }))

import { inviteMemberAction, changeRoleAction, revokeMemberAction } from "../app/dashboard/team/actions"

const OWNER = { wallet: { id: "wallet_1", name: "Meridian", ownerEmail: "cto@meridian.com" }, role: "owner", actor: { type: "user", userId: "u_owner", email: "cto@meridian.com", name: "CTO" } }
const ADMIN = { wallet: OWNER.wallet, role: "admin", actor: { type: "user", userId: "u_admin", email: "cfo@meridian.com", name: "CFO" } }

function form(fields: Record<string, string>) {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}

beforeEach(() => vi.clearAllMocks())

describe("inviteMemberAction", () => {
  it("refuses a non-owner session", async () => {
    sessionMock.getSessionMember.mockResolvedValue(ADMIN)
    const res = await inviteMemberAction({ ok: false, error: "" }, form({ email: "ceo@meridian.com", role: "viewer" }))
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/only the wallet owner/i)
    expect(dbMock.walletMember.create).not.toHaveBeenCalled()
  })

  it("refuses with no session at all", async () => {
    sessionMock.getSessionMember.mockResolvedValue(null)
    const res = await inviteMemberAction({ ok: false, error: "" }, form({ email: "ceo@meridian.com", role: "viewer" }))
    expect(res.ok).toBe(false)
  })

  it("rate-limits invite sends", async () => {
    sessionMock.getSessionMember.mockResolvedValue(OWNER)
    rateLimitMock.mockResolvedValueOnce({ ok: false, retryAfter: 60, limit: 20 })
    const res = await inviteMemberAction({ ok: false, error: "" }, form({ email: "ceo@meridian.com", role: "viewer" }))
    expect(res.error).toMatch(/too many invites/i)
  })

  it("rejects an invalid email", async () => {
    sessionMock.getSessionMember.mockResolvedValue(OWNER)
    const res = await inviteMemberAction({ ok: false, error: "" }, form({ email: "not-an-email", role: "viewer" }))
    expect(res.ok).toBe(false)
  })

  it("rejects an invalid role", async () => {
    sessionMock.getSessionMember.mockResolvedValue(OWNER)
    const res = await inviteMemberAction({ ok: false, error: "" }, form({ email: "ceo@meridian.com", role: "superadmin" }))
    expect(res.ok).toBe(false)
  })

  it("refuses to re-invite an already-active member", async () => {
    sessionMock.getSessionMember.mockResolvedValue(OWNER)
    dbMock.walletMember.findUnique.mockResolvedValue({ id: "m1", status: "active" })
    const res = await inviteMemberAction({ ok: false, error: "" }, form({ email: "cfo@meridian.com", role: "admin" }))
    expect(res.error).toMatch(/already a member/i)
    expect(dbMock.walletMember.create).not.toHaveBeenCalled()
  })

  it("creates a pending member, hashes the token, and emails the invite", async () => {
    sessionMock.getSessionMember.mockResolvedValue(OWNER)
    dbMock.walletMember.findUnique.mockResolvedValue(null)
    const res = await inviteMemberAction({ ok: false, error: "" }, form({ email: "CEO@Meridian.com", role: "viewer" }))

    expect(res.ok).toBe(true)
    const data = dbMock.walletMember.create.mock.calls[0][0].data
    expect(data.email).toBe("ceo@meridian.com") // lowercase-normalized
    expect(data.role).toBe("viewer")
    expect(data.status).toBe("pending")
    expect(data.tokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(data.invitedByUserId).toBe("u_owner")

    const sent = emailMock.sendInviteEmail.mock.calls[0]
    expect(sent[0]).toBe("ceo@meridian.com")
    expect(sent[1].link).toContain("/invite/")
    expect(JSON.stringify(sent)).not.toContain(data.tokenHash) // raw token in the link, never the hash exposed as "the token"
    expect(revalidateMock).toHaveBeenCalledWith("/dashboard/team")
  })

  it("refuses to invite the wallet's own owner email", async () => {
    sessionMock.getSessionMember.mockResolvedValue(OWNER)
    const res = await inviteMemberAction({ ok: false, error: "" }, form({ email: "cto@meridian.com", role: "admin" }))
    expect(res.ok).toBe(false)
  })
})

describe("changeRoleAction", () => {
  it("no-ops for a non-owner session", async () => {
    sessionMock.getSessionMember.mockResolvedValue(ADMIN)
    await changeRoleAction(form({ member_id: "m1", role: "owner" }))
    expect(dbMock.walletMember.update).not.toHaveBeenCalled()
  })

  it("no-ops when the target member belongs to a different wallet", async () => {
    sessionMock.getSessionMember.mockResolvedValue(OWNER)
    dbMock.walletMember.findUnique.mockResolvedValue({ id: "m1", walletId: "wallet_other" })
    await changeRoleAction(form({ member_id: "m1", role: "owner" }))
    expect(dbMock.walletMember.update).not.toHaveBeenCalled()
  })

  it("updates the role when the owner targets a member of their own wallet", async () => {
    sessionMock.getSessionMember.mockResolvedValue(OWNER)
    dbMock.walletMember.findUnique.mockResolvedValue({ id: "m1", walletId: "wallet_1" })
    await changeRoleAction(form({ member_id: "m1", role: "owner" }))
    expect(dbMock.walletMember.update).toHaveBeenCalledWith({ where: { id: "m1" }, data: { role: "owner" } })
  })
})

describe("revokeMemberAction", () => {
  it("no-ops for a non-owner session", async () => {
    sessionMock.getSessionMember.mockResolvedValue(ADMIN)
    await revokeMemberAction(form({ member_id: "m1" }))
    expect(dbMock.walletMember.update).not.toHaveBeenCalled()
  })

  it("revokes and clears the token for an owned member", async () => {
    sessionMock.getSessionMember.mockResolvedValue(OWNER)
    dbMock.walletMember.findUnique.mockResolvedValue({ id: "m1", walletId: "wallet_1" })
    await revokeMemberAction(form({ member_id: "m1" }))
    const data = dbMock.walletMember.update.mock.calls[0][0].data
    expect(data.status).toBe("revoked")
    expect(data.tokenHash).toBeNull()
  })
})
