import { beforeEach, describe, expect, it, vi } from "vitest"
import { readBillingCsv } from "@/lib/cursorCsv"
import { importBillingBatch } from "@/app/dashboard/usage/cursor/actions"

const mocks = vi.hoisted(() => ({ role: vi.fn(), createMany: vi.fn() }))
vi.mock("@/lib/session", () => ({ requireSessionRole: mocks.role }))
vi.mock("@/lib/db", () => ({ db: { cursorBillingItem: { createMany: mocks.createMany } } }))

const header = ["Product", "User Email", "Usage", "Pricing Currency", "Charge Category",
  "Billing Item ID", "Usage Type", "Model", "Pricing Contracted", "Event Time", "Principal ID"]
const sample = ["cursor", "test@example.test", '{"prompt-text-tokens":"0","completion-text-tokens":23}', "USD",
  "usage", "item-1", "included", "model, with comma", "0.0000000001", "2026-10-21T12:00:00.000Z", "private-principal"]
const csv = (...rows: string[][]) => "\uFEFF" + [header, ...rows].map(row => row.map(v => '"' + v.replaceAll('"', '""') + '"').join(",")).join("\r\n")
const replace = (column: string, value: string) => sample.map((original, i) => header[i] === column ? value : original)

const readCursorCsv = (text: string) => readBillingCsv(text, "cursor")

describe("Cursor unified billing exports", () => {
  beforeEach(() => vi.resetAllMocks())

  it("keeps reported precision and partial units, drops identity fields, skips other products", () => {
    const result = readCursorCsv(csv(sample, replace("Product", "other")))
    expect(result.skipped).toBe(1)
    expect(result.rows).toEqual([{
      product: "cursor", chargeCategory: "usage", usageType: "included", itemId: "item-1",
      model: "model, with comma", currency: "USD", contracted: "0.0000000001", occurredAt: sample[9],
      promptTokens: 0, completionTokens: 23, cachedPromptTokens: null, cacheWriteTokens: null,
    }])
    const unknown = readCursorCsv(csv(replace("Usage", "{}"), replace("Pricing Contracted", ""))).rows
    expect(unknown[0].promptTokens).toBeNull()
    expect(unknown[1].contracted).toBeNull()
  })

  it("extracts only the selected product from a mixed export without principal fields", () => {
    const mixed = csv(sample, replace("Product", "grok-bot"), replace("Product", "other"))
    for (const product of ["cursor", "grok-bot"] as const) {
      const { rows, skipped } = readBillingCsv(mixed, product)
      expect(skipped).toBe(2)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ product, itemId: "item-1", occurredAt: sample[9], completionTokens: 23 })
      expect(JSON.stringify(rows)).not.toMatch(/test@example|private-principal/)
    }
  })

  it.each([
    ["Usage", '{"image-seconds":1}'], ["Usage", '{"prompt-text-tokens":false}'],
    ["Usage", '{"prompt-text-tokens":-1}'], ["Usage", '{"prompt-text-tokens":2147483648}'],
    ["Event Time", "later"], ["Pricing Contracted", "0.00000000001"], ["Pricing Currency", ""],
  ])("rejects unsupported %s value %s before import", (column, value) => {
    expect(() => readCursorCsv(csv(sample, replace(column, value)))).toThrow("record 2")
  })

  it("binds stable hashes to the authenticated wallet and uses database conflict handling", async () => {
    mocks.role.mockResolvedValue({ id: "wallet-A" })
    mocks.createMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 })
    const { rows } = readCursorCsv(csv(sample))
    expect(await importBillingBatch("wallet-A", "cursor", rows)).toBe(1)
    expect(await importBillingBatch("wallet-A", "cursor", rows)).toBe(0)
    expect(mocks.role).toHaveBeenCalledWith("admin")
    const first = mocks.createMany.mock.calls[0][0]
    expect(mocks.createMany.mock.calls[1][0]).toEqual(first)
    expect(first).toMatchObject({ skipDuplicates: true, data: [{ walletId: "wallet-A", itemHash: expect.stringMatching(/^[0-9a-f]{64}$/) }] })
    expect(first.data[0]).not.toHaveProperty("itemId")
  })

  it("rejects a missing admin session, wallet switches and forged rows", async () => {
    const { rows } = readCursorCsv(csv(sample))
    mocks.role.mockResolvedValueOnce(null).mockResolvedValue({ id: "wallet-B" })
    await expect(importBillingBatch("wallet-A", "cursor", rows)).rejects.toThrow()
    await expect(importBillingBatch("wallet-A", "cursor", rows)).rejects.toThrow()
    for (const payload of [[], Array(251).fill(rows[0]), [{ ...rows[0], product: "other" }], [{ ...rows[0], product: "grok-bot" }], [{ ...rows[0], walletId: "wallet-A" }]]) {
      await expect(importBillingBatch("wallet-B", "cursor", payload)).rejects.toThrow()
    }
    expect(mocks.createMany).not.toHaveBeenCalled()
  })
})
