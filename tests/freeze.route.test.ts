import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { hashApiKey } from "../lib/apiKey"

// KILL-1 wire contract: freeze/unfreeze are owner-only, validate their body,
// stamp/clear frozenAt+frozenReason, and freeze announces subtree scope.

const { dbMock } = vi.hoisted(() => ({
  dbMock: { wallet: { findUnique: vi.fn(), update: vi.fn() } },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))

import { POST as freeze } from "../app/api/v1/wallets/freeze/route"
import { POST as unfreeze } from "../app/api/v1/wallets/unfreeze/route"

const SK = "sk_testmanagementkey"
const WID = "wallet_1"
const OWNER_WALLET = { id: WID, name: "Acme", parentId: null, mgmtKeyHash: hashApiKey(SK), mgmtKeyPrefix: "sk_testmana" }

function req(path: string, body: unknown, headers: Record<string, string> = { "x-mgmt-key": SK }) {
  return new NextRequest(`https://test.local/api/v1/wallets/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.wallet.findUnique.mockResolvedValue(OWNER_WALLET)
})

describe("POST /v1/wallets/freeze", () => {
  it("400s on a bad body before touching auth", async () => {
    expect((await freeze(req("freeze", {}))).status).toBe(400)
    expect(dbMock.wallet.findUnique).not.toHaveBeenCalled()
  })

  it("owner-only: wrong key 401s, missing key 401s, and nothing is written", async () => {
    expect((await freeze(req("freeze", { wallet_id: WID }, { "x-mgmt-key": "sk_wrong" }))).status).toBe(401)
    expect((await freeze(req("freeze", { wallet_id: WID }, {}))).status).toBe(401)
    expect(dbMock.wallet.update).not.toHaveBeenCalled()
  })

  it("freezes with a reason and announces subtree scope", async () => {
    const at = new Date("2026-07-07T12:00:00Z")
    dbMock.wallet.update.mockResolvedValue({ id: WID, frozenAt: at, frozenReason: "incident" })

    const res = await freeze(req("freeze", { wallet_id: WID, reason: "incident" }))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      wallet_id: WID,
      frozen: true,
      reason: "incident",
      scope: "wallet and entire subtree",
    })
    const write = dbMock.wallet.update.mock.calls[0][0]
    expect(write.where).toEqual({ id: WID })
    expect(write.data.frozenAt).toBeInstanceOf(Date)
    expect(write.data.frozenReason).toBe("incident")
  })

  it("reason is optional and stored as null", async () => {
    dbMock.wallet.update.mockResolvedValue({ id: WID, frozenAt: new Date(), frozenReason: null })

    const res = await freeze(req("freeze", { wallet_id: WID }))

    expect(res.status).toBe(200)
    expect(dbMock.wallet.update.mock.calls[0][0].data.frozenReason).toBeNull()
  })

  it("rejects a reason over 300 chars", async () => {
    expect((await freeze(req("freeze", { wallet_id: WID, reason: "x".repeat(301) }))).status).toBe(400)
  })
})

describe("POST /v1/wallets/unfreeze", () => {
  it("400s on a bad body", async () => {
    expect((await unfreeze(req("unfreeze", { wallet_id: "" }))).status).toBe(400)
  })

  it("owner-only: wrong key 401s and nothing is written", async () => {
    expect((await unfreeze(req("unfreeze", { wallet_id: WID }, { "x-mgmt-key": "sk_wrong" }))).status).toBe(401)
    expect(dbMock.wallet.update).not.toHaveBeenCalled()
  })

  it("clears the freeze fields on THIS wallet only", async () => {
    dbMock.wallet.update.mockResolvedValue({ id: WID })

    const res = await unfreeze(req("unfreeze", { wallet_id: WID }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ wallet_id: WID, frozen: false })
    expect(dbMock.wallet.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: WID }, data: { frozenAt: null, frozenReason: null } }),
    )
  })

  it("404s for an unknown wallet", async () => {
    dbMock.wallet.findUnique.mockResolvedValue(null)
    expect((await unfreeze(req("unfreeze", { wallet_id: "wallet_ghost" }))).status).toBe(404)
  })
})
