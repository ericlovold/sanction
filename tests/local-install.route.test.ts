import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

// Cookie-authed signed evidence export (LOCAL-1). Same AUDIT-1 document as the
// management-plane route, but gated on the SESSION wallet so a browser can
// download without an sk_ header. Demo view must never export.
const { sessionMock, exportMock } = vi.hoisted(() => ({
  sessionMock: { getSessionWallet: vi.fn() },
  exportMock: vi.fn(),
}))
vi.mock("@/lib/session", () => sessionMock)
vi.mock("@/lib/auditExport", () => ({
  buildWalletExport: exportMock,
  MAX_EXPORT_ROWS: 10000,
}))

import { GET } from "../app/dashboard/audit/export/signed/route"

const SECRET = "test-signing-secret"

function req(path = "/dashboard/audit/export/signed?from=2026-07-01&to=2026-07-10") {
  return new NextRequest(`https://test.local${path}`, { method: "GET" })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("SANCTION_SIGNING_SECRET", SECRET)
  sessionMock.getSessionWallet.mockResolvedValue({ id: "wallet_1", name: "acme" })
  exportMock.mockResolvedValue({
    export: {
      version: "sanction-audit-v1",
      algo: "sha256-chain+hmac-sha256",
      wallet_id: "wallet_1",
      from: "2026-07-01",
      to: "2026-07-10",
      count: 0,
      head: "seed",
      generated_at: "2026-07-10T00:00:00.000Z",
      decisions: [],
      chain: [],
      signature: "sha256=deadbeef",
    },
    truncated: false,
  })
})

describe("audit signed evidence export route", () => {
  it("fails closed with 401 and no read when there is no session (demo view)", async () => {
    sessionMock.getSessionWallet.mockResolvedValue(null)
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(exportMock).not.toHaveBeenCalled()
  })

  it("503s when signing is not configured", async () => {
    vi.stubEnv("SANCTION_SIGNING_SECRET", "")
    const res = await GET(req())
    expect(res.status).toBe(503)
    expect(exportMock).not.toHaveBeenCalled()
  })

  it("400s an invalid range before reading", async () => {
    const res = await GET(req("/dashboard/audit/export/signed?from=not-a-date&to=2026-07-10"))
    expect(res.status).toBe(400)
    expect(exportMock).not.toHaveBeenCalled()
  })

  it("streams the signed JSON with attachment headers on the happy path", async () => {
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Disposition")).toContain(
      'attachment; filename="sanction-evidence-wallet_1-2026-07-01_2026-07-10.json"',
    )
    expect(res.headers.get("Cache-Control")).toBe("no-store")
    const body = await res.json()
    expect(body.wallet_id).toBe("wallet_1")
    expect(exportMock).toHaveBeenCalledWith(
      "wallet_1",
      "2026-07-01",
      "2026-07-10",
      expect.any(Date),
      expect.any(Date),
      SECRET,
      expect.any(String),
    )
  })
})

describe("no-egress pack shape", () => {
  it("is the Local channel pack with an exact local-only allow-list", async () => {
    const { findPack, POLICY_PACKS } = await import("@/lib/policyPacks")
    const { policyInputSchema } = await import("@/lib/policy")
    const pack = findPack("no-egress")
    expect(pack).not.toBeNull()
    expect(pack!.channel).toBe("local")
    expect(pack!.maturity).toBe("evidence")
    expect(pack!.policy.allowed_tools).toEqual([
      "local.ollama",
      "local.chroma",
      "local.embeddings",
      "local.memory",
    ])
    expect(pack!.policy.blocked_tools).toContain("anthropic.messages")
    expect(pack!.policy.blocked_tools).toContain("web.fetch")
    expect(policyInputSchema.safeParse(pack!.policy).success).toBe(true)
    expect(POLICY_PACKS.filter((p) => p.id === "no-egress")).toHaveLength(1)
  })
})
