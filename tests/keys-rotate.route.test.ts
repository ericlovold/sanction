import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { hashApiKey } from "../lib/apiKey"

// SEC-1 Phase 2 surface: owner-only wallet DEK rotation, plus the public
// OpenAPI document. Rotation math (wrap/rewrap) is proven in crypto.test.ts;
// this proves the HTTP contract.
const { dbMock } = vi.hoisted(() => ({
  dbMock: { wallet: { findUnique: vi.fn() }, agent: { findUnique: vi.fn() } },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("@/lib/credentialCrypto", async (orig) => {
  const mod = await orig<typeof import("@/lib/credentialCrypto")>()
  return { ...mod, rotateWalletKey: vi.fn() }
})

import { POST as rotateKey } from "../app/api/v1/wallets/keys/rotate/route"
import { GET as openapi } from "../app/api/openapi.json/route"
import { rotateWalletKey } from "../lib/credentialCrypto"

const SK = "sk_testmanagementkey"
const WID = "wallet_1"

function req(body?: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("https://test.local/api/v1/wallets/keys/rotate", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body ?? {}),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.wallet.findUnique.mockResolvedValue({ id: WID, name: "Acme", parentId: null, mgmtKeyHash: hashApiKey(SK), mgmtKeyPrefix: "sk_testmana" })
})

describe("wallets/keys/rotate — SEC-1 Phase 2, owner-only", () => {
  it("400 without wallet_id; 401 without the owner key", async () => {
    expect((await rotateKey(req({}, { "x-mgmt-key": SK }))).status).toBe(400)
    dbMock.wallet.findUnique.mockResolvedValue(null)
    expect((await rotateKey(req({ wallet_id: WID }))).status).toBe(401)
    expect(rotateWalletKey).not.toHaveBeenCalled()
  })

  it("rotates for the owner and reports local vs kms root of trust", async () => {
    vi.mocked(rotateWalletKey).mockResolvedValue({ keyId: "wk_2", keyRef: "local", retiredPrevious: true } as never)
    const res = await rotateKey(req({ wallet_id: WID }, { "x-mgmt-key": SK }))
    expect(res.status).toBe(200)
    expect((await res.json())).toMatchObject({ key_id: "wk_2", key_ref: "local", retired_previous: true })

    vi.mocked(rotateWalletKey).mockResolvedValue({ keyId: "wk_3", keyRef: "arn:aws:kms:us-east-1:1:key/x", retiredPrevious: true } as never)
    const kms = await rotateKey(req({ wallet_id: WID }, { "x-mgmt-key": SK }))
    expect((await kms.json()).key_ref).toBe("kms") // never leaks the ARN
  })
})

describe("openapi.json — the public contract document", () => {
  it("serves the spec CORS-open and cacheable", async () => {
    const res = await openapi()
    expect(res.status).toBe(200)
    expect(res.headers.get("access-control-allow-origin")).toBe("*")
    const body = await res.json()
    expect(body.openapi).toBeTruthy()
    expect(body.paths["/authorize/tool"]).toBeTruthy() // yesterday's endpoint is documented
  })
})
