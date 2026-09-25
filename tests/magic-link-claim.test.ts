import { describe, it, expect, vi, beforeEach } from "vitest"

// Magic-link verify (app/login/actions.ts verifyMagicLinkAction). The link
// proves the holder controls ownerEmail. On a wallet whose ownerEmail was never
// proven, that proof is a claim: whoever set the email at signup may be a
// squatter holding the sk_ key and agent keys, so the first proof rotates every
// pre-claim credential (same set as the social claim in lib/session.ts), sets
// ownerEmailVerifiedAt, and sweeps again after commit. On an already-verified
// wallet it is plain key recovery: only the sk_ key rotates.
const { dbMock, cookieStore } = vi.hoisted(() => {
  const dbMock = {
    magicLink: { findUnique: vi.fn(), updateMany: vi.fn() },
    user: { findUnique: vi.fn() },
    wallet: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    walletMember: { updateMany: vi.fn() },
    executionToken: { updateMany: vi.fn() },
    webhook: { deleteMany: vi.fn() },
    slackInstall: { updateMany: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  }
  return { dbMock, cookieStore: { get: vi.fn(), set: vi.fn(), delete: vi.fn() } }
})
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("next/headers", () => ({ cookies: async () => cookieStore, headers: async () => new Headers() }))
vi.mock("@/lib/auth-config", () => ({ auth: { api: { getSession: vi.fn(), signOut: vi.fn() } } }))

import { verifyMagicLinkAction } from "../app/login/actions"
import { hashApiKey } from "../lib/apiKey"

const TOKEN = "a".repeat(64)
const LINK = { id: "ml_1", walletId: "wallet_1", email: "owner@corp.com", usedAt: null, expiresAt: new Date(Date.now() + 60_000) }
const WALLET = { id: "wallet_1", name: "Acme", ownerEmail: "owner@corp.com", userId: null }

function form() {
  const f = new FormData()
  f.set("token", TOKEN)
  return f
}
const rawSql = () => dbMock.$executeRaw.mock.calls.map(([strings]) => (strings as string[]).join("?"))
const agentRotations = () => rawSql().filter((sql) => sql.includes('UPDATE "Agent"'))
// wallet.updateMany serves two writes: the first-proof flip (ownerEmailVerifiedAt)
// and the email-guarded sk_ rotation (mgmtKeyHash).
type WalletWrite = { where: Record<string, unknown>; data: Record<string, unknown> }
function walletWrites(firstProofCount: number, rotationCount = 1) {
  dbMock.wallet.updateMany.mockImplementation(async ({ data }: WalletWrite) =>
    ({ count: "mgmtKeyHash" in data ? rotationCount : firstProofCount }),
  )
}
const verifyFlip = () => dbMock.wallet.updateMany.mock.calls.map(([a]) => a as WalletWrite).find((a) => "ownerEmailVerifiedAt" in a.data)
const keyRotation = () => dbMock.wallet.updateMany.mock.calls.map(([a]) => a as WalletWrite).find((a) => "mgmtKeyHash" in a.data)

beforeEach(() => {
  vi.resetAllMocks()
  dbMock.$transaction.mockImplementation((fn: (tx: typeof dbMock) => unknown) => fn(dbMock))
  dbMock.$executeRaw.mockResolvedValue(0)
  dbMock.magicLink.findUnique.mockResolvedValue(LINK)
  dbMock.magicLink.updateMany.mockResolvedValue({ count: 1 })
  dbMock.wallet.findUnique.mockResolvedValue(WALLET)
  dbMock.wallet.update.mockResolvedValue(WALLET)
  dbMock.wallet.findUniqueOrThrow.mockResolvedValue(WALLET)
  for (const m of [dbMock.executionToken, dbMock.walletMember, dbMock.slackInstall]) m.updateMany.mockResolvedValue({ count: 0 })
  dbMock.webhook.deleteMany.mockResolvedValue({ count: 0 })
})

describe("verifyMagicLinkAction — first proof of an unverified ownerEmail is a claim", () => {
  it("rotates every pre-claim credential, marks the email verified, issues a new sk_, and sweeps after commit", async () => {
    walletWrites(1) // was unverified
    dbMock.$executeRaw.mockImplementation(async (strings: string[]) =>
      strings.join("?").includes('UPDATE "Agent"') ? 3 : 0,
    )

    const res = await verifyMagicLinkAction({ ok: false, error: "" }, form())

    expect(res.ok).toBe(true)
    expect(res.newKey).toMatch(/^sk_/)
    expect(res.rotatedAgents).toBe(3)

    // Race-safe: only the request that flips ownerEmailVerifiedAt from null (for
    // the email this link was sent to) runs the claim.
    const claim = verifyFlip()!
    expect(claim.where).toEqual({ id: WALLET.id, ownerEmail: LINK.email, ownerEmailVerifiedAt: null })
    expect(claim.data.ownerEmailVerifiedAt).toBeInstanceOf(Date)

    // Claim tx + post-commit sweep.
    expect(dbMock.$transaction).toHaveBeenCalledTimes(2)
    expect(agentRotations()).toHaveLength(2)
    expect(dbMock.executionToken.updateMany).toHaveBeenCalledTimes(2)
    expect(dbMock.executionToken.updateMany.mock.calls[0][0].where).toEqual({ walletId: WALLET.id, status: "active" })
    expect(dbMock.walletMember.updateMany).toHaveBeenCalledTimes(2)
    expect(dbMock.slackInstall.updateMany).toHaveBeenCalledTimes(2)
    // Squatter webhooks are deleted, not deactivated.
    expect(dbMock.webhook.deleteMany).toHaveBeenCalledTimes(2)
    expect(dbMock.webhook.deleteMany.mock.calls[0][0]).toEqual({ where: { walletId: WALLET.id } })

    // The new sk_ is what gets stored and what the session carries.
    const upd = keyRotation()!
    expect(upd.where).toEqual({ id: WALLET.id, ownerEmail: LINK.email })
    expect(upd.data.mgmtKeyHash).toBe(hashApiKey(res.newKey!))
    expect(cookieStore.set.mock.calls.at(-1)?.[1]).toBe(res.newKey)
  })

  it("a failing post-commit sweep fails closed — no session, no key handed back", async () => {
    walletWrites(1)
    dbMock.slackInstall.updateMany.mockResolvedValueOnce({ count: 0 }).mockRejectedValueOnce(new Error("connection reset"))

    await expect(verifyMagicLinkAction({ ok: false, error: "" }, form())).rejects.toThrow("connection reset")
    expect(cookieStore.set).not.toHaveBeenCalled()
  })
})

describe("verifyMagicLinkAction — already-verified wallet is key recovery", () => {
  it("rotates only the sk_ key; agents, tokens, members, webhooks, Slack untouched", async () => {
    walletWrites(0) // already verified

    const res = await verifyMagicLinkAction({ ok: false, error: "" }, form())

    expect(res.ok).toBe(true)
    expect(res.newKey).toMatch(/^sk_/)
    expect(res.rotatedAgents).toBeUndefined()
    expect(agentRotations()).toHaveLength(0)
    expect(dbMock.executionToken.updateMany).not.toHaveBeenCalled()
    expect(dbMock.walletMember.updateMany).not.toHaveBeenCalled()
    expect(dbMock.webhook.deleteMany).not.toHaveBeenCalled()
    expect(dbMock.slackInstall.updateMany).not.toHaveBeenCalled()
    expect(dbMock.$transaction).toHaveBeenCalledTimes(1) // no sweep
    expect(keyRotation()!.data.mgmtKeyHash).toBe(hashApiKey(res.newKey!))
  })
})

describe("verifyMagicLinkAction — a wallet already linked to a signed-in owner", () => {
  it("verifies a changed ownerEmail without rotating the owner's own agents", async () => {
    dbMock.wallet.findUnique.mockResolvedValue({ ...WALLET, userId: "user_owner" })
    dbMock.user.findUnique.mockResolvedValue({ email: "Owner@Corp.com", emailVerified: true }) // the owner's own inbox
    walletWrites(1) // first proof of the new address

    const res = await verifyMagicLinkAction({ ok: false, error: "" }, form())

    expect(res.ok).toBe(true)
    expect(res.rotatedAgents).toBeUndefined()
    expect(verifyFlip()!.data.ownerEmailVerifiedAt).toBeInstanceOf(Date)
    expect(agentRotations()).toHaveLength(0)
    expect(dbMock.webhook.deleteMany).not.toHaveBeenCalled()
    expect(dbMock.$transaction).toHaveBeenCalledTimes(1) // no sweep
  })
})

describe("verifyMagicLinkAction — a linked owner retargeting ownerEmail at someone else", () => {
  it("the inbox holder's first proof is a claim: pre-claim access rotated and the linked owner unlinked", async () => {
    dbMock.wallet.findUnique.mockResolvedValue({ ...WALLET, userId: "user_attacker" })
    dbMock.user.findUnique.mockResolvedValue({ email: "attacker@evil.test", emailVerified: true })
    walletWrites(1)

    const res = await verifyMagicLinkAction({ ok: false, error: "" }, form())

    expect(res.ok).toBe(true)
    expect(res.rotatedAgents).toBeDefined()
    expect(agentRotations().length).toBeGreaterThan(0)
    expect(dbMock.webhook.deleteMany).toHaveBeenCalled()
    const unlink = dbMock.wallet.updateMany.mock.calls.map(([a]) => a as WalletWrite).find((a) => "userId" in a.data)
    expect(unlink?.data).toEqual({ userId: null })
  })

  it("a linked owner whose own email is unverified gets no exemption", async () => {
    dbMock.wallet.findUnique.mockResolvedValue({ ...WALLET, userId: "user_owner" })
    dbMock.user.findUnique.mockResolvedValue({ email: WALLET.ownerEmail, emailVerified: false })
    walletWrites(1)

    const res = await verifyMagicLinkAction({ ok: false, error: "" }, form())

    expect(res.rotatedAgents).toBeDefined()
  })
})

describe("verifyMagicLinkAction — stale links", () => {
  it("rejects a link sent to an email that is no longer the wallet's ownerEmail", async () => {
    dbMock.wallet.findUnique.mockResolvedValue({ ...WALLET, ownerEmail: "someone-else@corp.com" })

    const res = await verifyMagicLinkAction({ ok: false, error: "" }, form())

    expect(res.ok).toBe(false)
    expect(dbMock.wallet.update).not.toHaveBeenCalled()
    expect(dbMock.wallet.updateMany).not.toHaveBeenCalled()
    expect(cookieStore.set).not.toHaveBeenCalled()
  })

  it("rejects a link whose address is replaced mid-flight — no key, no session, verification rolled back", async () => {
    walletWrites(1, 0) // the email-guarded key rotation matches nothing: ownerEmail changed after the pre-check

    const res = await verifyMagicLinkAction({ ok: false, error: "" }, form())

    expect(res.ok).toBe(false)
    expect(res.newKey).toBeUndefined()
    expect(keyRotation()!.where).toEqual({ id: WALLET.id, ownerEmail: LINK.email })
    expect(cookieStore.set).not.toHaveBeenCalled()
  })

  it("rejects a used link without touching the wallet", async () => {
    dbMock.magicLink.findUnique.mockResolvedValue({ ...LINK, usedAt: new Date() })
    const res = await verifyMagicLinkAction({ ok: false, error: "" }, form())
    expect(res.ok).toBe(false)
    expect(dbMock.wallet.update).not.toHaveBeenCalled()
  })
})
