import { Client } from "pg"
import type { ConnectionOptions } from "node:tls"
import { afterEach, describe, expect, it, vi } from "vitest"
import { verifiedDatabaseUrl } from "../lib/databaseUrl"

afterEach(() => vi.restoreAllMocks())

describe("database TLS configuration", () => {
  it.each(["prefer", "require", "verify-ca"])("pins %s to full verification without a driver warning", (mode) => {
    const warning = vi.spyOn(process, "emitWarning").mockImplementation(() => {})
    for (const compat of ["", "&uselibpqcompat=true"]) {
      const url = verifiedDatabaseUrl(`postgres://user:password@db.example/test?sslmode=${mode}${compat}`)
      expect(new URL(url).searchParams.get("sslmode")).toBe("verify-full")
      const client = new Client({ connectionString: url })
      const ssl = client.ssl as unknown as ConnectionOptions
      expect(ssl).toEqual({}) // Node TLS defaults verify the chain and hostname.
      expect(ssl.rejectUnauthorized).not.toBe(false)
      expect(ssl.checkServerIdentity).toBeUndefined()
    }
    expect(warning).not.toHaveBeenCalled()
  })

  it("preserves encoded credentials, host, database and unrelated connection options", () => {
    const original = "postgresql://u%40ser:p%2F%23%3F%25@db-pooler.example:5432/my%20db?sslmode=require&channel_binding=require&application_name=hello%20world"
    const normalized = new URL(verifiedDatabaseUrl(original))
    const before = new URL(original)
    expect(normalized.username).toBe(before.username)
    expect(normalized.password).toBe(before.password)
    expect(normalized.host).toBe(before.host)
    expect(normalized.pathname).toBe(before.pathname)
    expect(normalized.searchParams.get("channel_binding")).toBe("require")
    expect(normalized.searchParams.get("application_name")).toBe("hello world")
  })

  it.each([
    "postgres://localhost/test",
    "postgres://localhost/test?sslmode=disable",
    "postgres://db.example/test?sslmode=verify-full",
    "/var/run/postgresql test",
    "not a URL",
  ])("leaves other connection formats and explicit modes unchanged: %s", (url) => {
    expect(verifiedDatabaseUrl(url)).toBe(url)
  })

  it("matches the driver's last-value handling for duplicate modes", () => {
    const url = verifiedDatabaseUrl("postgres://db.example/test?sslmode=disable&sslmode=require")
    expect(new URL(url).searchParams.getAll("sslmode")).toEqual(["verify-full"])
    const disabled = "postgres://localhost/test?sslmode=require&sslmode=disable"
    expect(verifiedDatabaseUrl(disabled)).toBe(disabled)
  })
})
