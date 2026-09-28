import { describe, it, expect, vi, afterEach } from "vitest"

// SEC-3: the production boot check must flag BYPASSRLS as well as SUPERUSER —
// Neon's default owner is rolsuper=false but inherits BYPASSRLS, which silently
// disables tenant RLS. Non-blocking: it only logs.
import { checkRlsRole } from "../lib/db"

const client = (row: { rolsuper: boolean; rolbypassrls: boolean } | undefined) =>
  ({ $queryRaw: vi.fn(async () => (row ? [row] : [])) }) as never

afterEach(() => vi.restoreAllMocks())

describe("checkRlsRole", () => {
  it("is silent for a restricted role", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await checkRlsRole(client({ rolsuper: false, rolbypassrls: false }))).toEqual([])
    expect(err).not.toHaveBeenCalled()
  })

  it("flags BYPASSRLS on a non-superuser (the Neon owner case)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await checkRlsRole(client({ rolsuper: false, rolbypassrls: true }))).toEqual(["BYPASSRLS"])
    expect(err).toHaveBeenCalledWith(expect.stringContaining("BYPASSRLS"))
  })

  it("names both when the role is a superuser with BYPASSRLS", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await checkRlsRole(client({ rolsuper: true, rolbypassrls: true }))).toEqual(["SUPERUSER", "BYPASSRLS"])
    expect(err).toHaveBeenCalledWith(expect.stringContaining("SUPERUSER + BYPASSRLS"))
  })

  it("stays quiet when the role row is missing", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await checkRlsRole(client(undefined))).toEqual([])
    expect(err).not.toHaveBeenCalled()
  })
})
