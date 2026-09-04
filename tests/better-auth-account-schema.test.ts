import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { Prisma } from "../lib/generated/prisma/client"

// Better Auth 1.7's Prisma adapter looks up social accounts with
// findFirst({ where: { AND: [{ issuer }, { accountId }] } }). That query
// threw PrismaClientValidationError in production when Account had no issuer.

describe("Better Auth Account.issuer", () => {
  it("generated client accepts find-by-issuer (the Google callback query)", () => {
    const where: Prisma.AccountWhereInput = {
      AND: [
        { issuer: { equals: "https://accounts.google.com" } },
        { accountId: { equals: "sub_example" } },
      ],
    }
    expect(Prisma.AccountScalarFieldEnum.issuer).toBe("issuer")
    expect(where).toEqual({
      AND: [
        { issuer: { equals: "https://accounts.google.com" } },
        { accountId: { equals: "sub_example" } },
      ],
    })
  })

  it("schema declares nullable issuer and the (issuer, accountId) unique the adapter uses", () => {
    const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8")
    const start = schema.indexOf("model Account {")
    const end = schema.indexOf("model Verification {")
    const account = schema.slice(start, end)
    expect(account).toMatch(/issuer\s+String\?/)
    expect(account).toMatch(/@@unique\(\[issuer,\s*accountId\]\)/)
    expect(account).toContain('@@map("account")')
  })
})
