import { describe, it, expect, vi } from "vitest"

// Capture what withTenant runs against the transaction client. We stub
// db.$transaction so no real DB is needed.
const calls: { raw: unknown[] } = { raw: [] }

vi.mock("../lib/db", () => ({
  db: {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
          calls.raw.push({ strings: Array.from(strings), values })
          return 1
        },
      }
      return fn(tx)
    },
  },
}))

import { withTenant } from "../lib/tenantDb"

describe("withTenant (SEC-3 query layer)", () => {
  it("rejects a walletId with illegal characters (SQL-injection guard)", async () => {
    await expect(
      withTenant("'; DROP TABLE x; --", async () => "nope"),
    ).rejects.toThrow(/Invalid walletId/)
  })

  it("rejects an empty walletId", async () => {
    await expect(withTenant("", async () => "nope")).rejects.toThrow(/Invalid walletId/)
  })

  it("accepts a cuid-shaped walletId and sets app.current_wallet via set_config", async () => {
    calls.raw = []
    const out = await withTenant("cmqefleko000004ieyqrer393", async () => "ok")
    expect(out).toBe("ok")
    // The first statement must be the parameterized set_config call.
    expect(calls.raw.length).toBe(1)
    const stmt = calls.raw[0] as { strings: string[]; values: unknown[] }
    expect(stmt.strings.join("?")).toContain("set_config('app.current_wallet'")
    expect(stmt.values).toContain("cmqefleko000004ieyqrer393")
  })
})
