import { describe, it, expect, vi, beforeEach } from "vitest"

// Claim-by-email (lib/session.ts resolveWalletForUser). POST /wallets and /start
// accept an unverified owner_email and hand back the sk_ key, so a wallet whose
// ownerEmail matches a signing-in user may have been squatted by whoever holds
// that key. A claim therefore requires a provider-verified email, and a
// successful claim rotates every credential minted before it: the sk_ key is
// cleared, agent keys are replaced and deactivated, live execution tokens are
// revoked, memberships the key holder handed out are revoked, Slack installs are
// revoked, and webhooks are deactivated — then a post-commit sweep repeats it to
// catch rows committed while the claim was in flight.
const { dbMock, cookieStore, sessionMock } = vi.hoisted(() => {
  const dbMock = {
    wallet: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    walletMember: { findFirst: vi.fn(), updateMany: vi.fn() },
    agent: { create: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    executionToken: { updateMany: vi.fn() },
    webhook: { updateMany: vi.fn() },
    slackInstall: { updateMany: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  }
  return { dbMock, cookieStore: { get: vi.fn() }, sessionMock: { getSession: vi.fn() } }
})
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("next/headers", () => ({ cookies: async () => cookieStore, headers: async () => new Headers() }))
vi.mock("@/lib/auth-config", () => ({ auth: { api: { getSession: sessionMock.getSession } } }))

import { getSessionMember, getSessionWallet } from "../lib/session"

const SQUATTED = {
  id: "wallet_sq",
  name: "victim's workspace",
  ownerEmail: "victim@corp.com",
  userId: null,
  mgmtKeyHash: "attacker_hash",
  mgmtKeyPrefix: "sk_attacker",
}
const VICTIM = { id: "user_victim", email: "victim@corp.com", name: "Victim" }

beforeEach(() => {
  vi.resetAllMocks()
  cookieStore.get.mockReturnValue(undefined)
  dbMock.$transaction.mockImplementation((fn: (tx: typeof dbMock) => unknown) => fn(dbMock))
  dbMock.$executeRaw.mockResolvedValue(0)
  for (const m of [dbMock.executionToken, dbMock.walletMember, dbMock.webhook, dbMock.slackInstall]) {
    m.updateMany.mockResolvedValue({ count: 0 })
  }
})

// Tagged-template $executeRaw calls, as SQL text (placeholders for params).
const rawSql = () => dbMock.$executeRaw.mock.calls.map(([strings]) => (strings as string[]).join("?"))
const agentRotations = () => rawSql().filter((sql) => sql.includes('UPDATE "Agent"'))

describe("resolveWalletForUser — claim-by-email", () => {
  it("a verified claim links the wallet and rotates every pre-claim credential in one transaction, then sweeps", async () => {
    sessionMock.getSession.mockResolvedValue({ user: { ...VICTIM, emailVerified: true } })
    dbMock.wallet.findFirst.mockResolvedValue(null)
    dbMock.wallet.findUnique
      .mockResolvedValueOnce(SQUATTED) // ownerEmail lookup
      .mockResolvedValueOnce({ ...SQUATTED, userId: VICTIM.id, mgmtKeyHash: null, mgmtKeyPrefix: null }) // post-claim re-read
    dbMock.wallet.updateMany.mockResolvedValue({ count: 1 })
    dbMock.$executeRaw.mockResolvedValueOnce(2) // agents rotated in the claim tx

    const result = await getSessionMember()

    expect(result?.wallet.id).toBe(SQUATTED.id)
    expect(result?.role).toBe("owner")
    // The claim transaction, then the post-commit sweep (withTenant).
    expect(dbMock.$transaction).toHaveBeenCalledTimes(2)

    // Conditional on still being unclaimed (race-safe), and kills the sk_ key.
    const claim = dbMock.wallet.updateMany.mock.calls[0][0]
    expect(claim.where).toEqual({ id: SQUATTED.id, userId: null })
    expect(claim.data).toEqual({ userId: VICTIM.id, mgmtKeyHash: null, mgmtKeyPrefix: null })

    // Agent keys rotated set-based (no read-then-write loop) to a value that can
    // never equal a sha256 hex digest, and deactivated — once in the claim, once
    // in the sweep.
    expect(dbMock.agent.findMany).not.toHaveBeenCalled()
    expect(dbMock.agent.update).not.toHaveBeenCalled()
    const rotations = agentRotations()
    expect(rotations).toHaveLength(2)
    for (const sql of rotations) {
      expect(sql).toContain(`"apiKeyHash" = 'claimed:' || gen_random_uuid()`)
      expect(sql).toContain(`"isActive" = false`)
      expect(sql).toContain(`WHERE "walletId" = ?`)
    }
    const rotationCalls = dbMock.$executeRaw.mock.calls.filter(([st]) => (st as string[]).join("?").includes('UPDATE "Agent"'))
    for (const call of rotationCalls) expect(call[1]).toBe(SQUATTED.id)

    // Live execution JWTs revoked; memberships handed out by the key holder revoked.
    const tokens = dbMock.executionToken.updateMany.mock.calls[0][0]
    expect(tokens.where).toEqual({ walletId: SQUATTED.id, status: "active" })
    expect(tokens.data.status).toBe("revoked")
    expect(tokens.data.revokedAt).toBeInstanceOf(Date)
    const members = dbMock.walletMember.updateMany.mock.calls[0][0]
    expect(members.where).toEqual({ walletId: SQUATTED.id, status: { not: "revoked" } })
    expect(members.data).toEqual({ status: "revoked", tokenHash: null, tokenExpiresAt: null })

    // A squatter's control/notification plane is cut: webhooks off, Slack revoked
    // under the tenant's RLS scope.
    const hooks = dbMock.webhook.updateMany.mock.calls[0][0]
    expect(hooks).toEqual({ where: { walletId: SQUATTED.id, isActive: true }, data: { isActive: false } })
    const slack = dbMock.slackInstall.updateMany.mock.calls[0][0]
    expect(slack.where).toEqual({ walletId: SQUATTED.id, revokedAt: null })
    expect(slack.data.revokedAt).toBeInstanceOf(Date)
    expect(rawSql().some((sql) => sql.includes("set_config('app.wallet_ids'"))).toBe(true)

    // The sweep repeats every revocation after commit.
    for (const m of [dbMock.executionToken, dbMock.walletMember, dbMock.webhook, dbMock.slackInstall]) {
      expect(m.updateMany).toHaveBeenCalledTimes(2)
    }

    // The old non-rotating update path is gone.
    expect(dbMock.wallet.update).not.toHaveBeenCalled()
  })

  it("entering through a squatter's invite (switcher cookie + membership) still claims and rotates", async () => {
    sessionMock.getSession.mockResolvedValue({ user: { ...VICTIM, emailVerified: true } })
    cookieStore.get.mockReturnValue({ value: SQUATTED.id }) // /invite sets the active-wallet cookie
    dbMock.walletMember.findFirst.mockResolvedValue({ walletId: SQUATTED.id, userId: VICTIM.id, status: "active", role: "admin" })
    dbMock.wallet.findFirst.mockResolvedValue(null)
    dbMock.wallet.findUnique
      .mockResolvedValueOnce(SQUATTED) // ownerEmail lookup — runs before the switcher branch
      .mockResolvedValueOnce({ ...SQUATTED, userId: VICTIM.id, mgmtKeyHash: null, mgmtKeyPrefix: null })
    dbMock.wallet.updateMany.mockResolvedValue({ count: 1 })

    const result = await getSessionMember()

    expect(result?.wallet.id).toBe(SQUATTED.id)
    expect(result?.role).toBe("owner")
    expect(dbMock.wallet.updateMany.mock.calls[0][0].data).toEqual({ userId: VICTIM.id, mgmtKeyHash: null, mgmtKeyPrefix: null })
    expect(agentRotations().length).toBeGreaterThan(0)
  })

  it("an unverified user never claims — or is handed — a squatted wallet", async () => {
    sessionMock.getSession.mockResolvedValue({ user: { ...VICTIM, emailVerified: false } })
    dbMock.wallet.findFirst.mockResolvedValue(null)
    dbMock.wallet.findUnique.mockResolvedValue(SQUATTED)
    dbMock.walletMember.findFirst.mockResolvedValue(null)
    // Even if a create were attempted it would collide on ownerEmail.
    dbMock.wallet.create.mockRejectedValue(new Error("Unique constraint failed on ownerEmail"))

    // getSessionWallet returns the resolver's pick unfiltered — the stricter probe.
    expect(await getSessionWallet()).toBeNull()
    expect(dbMock.$transaction).not.toHaveBeenCalled()
    expect(dbMock.wallet.update).not.toHaveBeenCalled()
    expect(dbMock.wallet.updateMany).not.toHaveBeenCalled()
  })

  it("a missing emailVerified flag is treated as unverified", async () => {
    sessionMock.getSession.mockResolvedValue({ user: VICTIM })
    dbMock.wallet.findFirst.mockResolvedValue(null)
    dbMock.wallet.findUnique.mockResolvedValue(SQUATTED)
    dbMock.walletMember.findFirst.mockResolvedValue(null)

    // getSessionWallet returns the resolver's pick unfiltered — the stricter probe.
    expect(await getSessionWallet()).toBeNull()
    expect(dbMock.wallet.updateMany).not.toHaveBeenCalled()
  })

  it("an unverified user losing a create race is not handed the winner's wallet", async () => {
    sessionMock.getSession.mockResolvedValue({ user: { ...VICTIM, emailVerified: false } })
    dbMock.wallet.findFirst.mockResolvedValue(null)
    dbMock.wallet.findUnique
      .mockResolvedValueOnce(null) // no wallet at lookup time
      .mockResolvedValueOnce(SQUATTED) // a squat landed before our create
    dbMock.walletMember.findFirst.mockResolvedValue(null)
    dbMock.wallet.create.mockRejectedValue(new Error("Unique constraint failed on ownerEmail"))

    // getSessionWallet returns the resolver's pick unfiltered — the stricter probe.
    expect(await getSessionWallet()).toBeNull()
  })

  it("a verified user whose claim loses the race gets nothing rather than a stale wallet", async () => {
    sessionMock.getSession.mockResolvedValue({ user: { ...VICTIM, emailVerified: true } })
    dbMock.wallet.findFirst.mockResolvedValue(null)
    dbMock.wallet.findUnique.mockResolvedValue(SQUATTED)
    dbMock.wallet.updateMany.mockResolvedValue({ count: 0 }) // someone else linked it first
    dbMock.walletMember.findFirst.mockResolvedValue(null)

    // getSessionWallet returns the resolver's pick unfiltered — the stricter probe.
    expect(await getSessionWallet()).toBeNull()
    expect(agentRotations()).toHaveLength(0)
    expect(dbMock.executionToken.updateMany).not.toHaveBeenCalled()
    expect(dbMock.slackInstall.updateMany).not.toHaveBeenCalled()
    expect(dbMock.$transaction).toHaveBeenCalledTimes(1) // no sweep
  })

  it("a failing post-commit sweep fails the claim closed rather than handing back the wallet", async () => {
    sessionMock.getSession.mockResolvedValue({ user: { ...VICTIM, emailVerified: true } })
    dbMock.wallet.findFirst.mockResolvedValue(null)
    dbMock.wallet.findUnique
      .mockResolvedValueOnce(SQUATTED)
      .mockResolvedValueOnce({ ...SQUATTED, userId: VICTIM.id, mgmtKeyHash: null, mgmtKeyPrefix: null })
    dbMock.wallet.updateMany.mockResolvedValue({ count: 1 })
    dbMock.slackInstall.updateMany
      .mockResolvedValueOnce({ count: 1 }) // claim tx
      .mockRejectedValueOnce(new Error("connection reset")) // sweep

    // getSessionMember swallows resolver errors and falls through to the (absent)
    // key cookie — so no session, not the claimed wallet.
    expect(await getSessionMember()).toBeNull()
  })

  it("an already-linked wallet is returned untouched — no re-claim, no rotation", async () => {
    const linked = { ...SQUATTED, userId: VICTIM.id, mgmtKeyHash: "owner_hash", mgmtKeyPrefix: "sk_owner" }
    sessionMock.getSession.mockResolvedValue({ user: { ...VICTIM, emailVerified: true } })
    dbMock.wallet.findFirst.mockResolvedValue(linked)

    const result = await getSessionMember()
    expect(result?.wallet).toBe(linked)
    expect(result?.role).toBe("owner")
    expect(dbMock.$transaction).not.toHaveBeenCalled()
    expect(dbMock.wallet.updateMany).not.toHaveBeenCalled()
    expect(agentRotations()).toHaveLength(0)
  })

  it("a verified user without a wallet still gets one provisioned", async () => {
    const fresh = { id: "wallet_new", ownerEmail: VICTIM.email, userId: VICTIM.id }
    sessionMock.getSession.mockResolvedValue({ user: { ...VICTIM, emailVerified: true } })
    dbMock.wallet.findFirst.mockResolvedValue(null)
    dbMock.wallet.findUnique.mockResolvedValue(null)
    dbMock.walletMember.findFirst.mockResolvedValue(null)
    dbMock.wallet.create.mockResolvedValue(fresh)
    dbMock.agent.create.mockResolvedValue({})

    const result = await getSessionMember()
    expect(result?.wallet.id).toBe("wallet_new")
    expect(result?.role).toBe("owner")
  })
})
