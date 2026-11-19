import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { patchOAuthRevocation } from "../scripts/patch-oauth-revocation.mjs"

const require = createRequire(import.meta.url)
const mcpRequire = createRequire(require.resolve("@better-auth/mcp"))
const installed = dirname(dirname(mcpRequire.resolve("@better-auth/oauth-provider")))
const moduleName = readdirSync(join(installed, "dist")).find(name => /^authorize-.*\.mjs$/.test(name))!
const patchedSource = readFileSync(join(installed, "dist", moduleName), "utf8")
const directories: string[] = []

function fixture(source = patchedSource, version = "1.7.18") {
  const directory = mkdtempSync(join(tmpdir(), "sanction-oauth-patch-"))
  directories.push(directory)
  mkdirSync(join(directory, "dist"))
  writeFileSync(join(directory, "package.json"), JSON.stringify({ name: "@better-auth/oauth-provider", version }))
  const target = join(directory, "dist", moduleName)
  writeFileSync(target, source)
  return { directory, target }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("OAuth revocation dependency patch", () => {
  it("applies the reviewed correction and can run again on cached dependencies", () => {
    const start = patchedSource.indexOf("async function revokeRefreshToken(")
    const end = patchedSource.indexOf("\n/**", start)
    const guard = "\tif (!refreshToken.clientId || refreshToken.clientId !== clientId) return null;\n"
    const corrected = patchedSource.slice(start, end)
    expect(corrected.indexOf(guard)).toBeLessThan(corrected.indexOf("\tif (refreshToken.revoked) {"))
    const original = corrected.replace(guard, "").replace("\tconst iat =", `${guard}\tconst iat =`)
    const { directory, target } = fixture(patchedSource.slice(0, start) + original + patchedSource.slice(end))
    expect(patchOAuthRevocation(directory)).toBe("patched")
    expect(readFileSync(target, "utf8")).toBe(patchedSource)
    expect(patchOAuthRevocation(directory)).toBe("already patched")
    expect(readFileSync(target, "utf8")).toBe(patchedSource)
  })

  it.each(["1.7.19", "1.7.25"])("requires review before accepting provider %s", version => {
    const { directory, target } = fixture(patchedSource, version)
    expect(() => patchOAuthRevocation(directory)).toThrow("Review the dependency")
    expect(readFileSync(target, "utf8")).toBe(patchedSource)
  })

  it("refuses unexpected source rather than silently applying a partial patch", () => {
    const changed = patchedSource + "\n// unexpected dependency content\n"
    const { directory, target } = fixture(changed)
    expect(() => patchOAuthRevocation(directory)).toThrow("Review the dependency")
    expect(readFileSync(target, "utf8")).toBe(changed)
  })

  it("refuses an ambiguous module layout", () => {
    const { directory } = fixture()
    writeFileSync(join(directory, "dist", "authorize-unexpected.mjs"), patchedSource)
    expect(() => patchOAuthRevocation(directory)).toThrow("Review the dependency")
  })
})
