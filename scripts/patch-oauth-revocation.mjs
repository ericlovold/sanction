#!/usr/bin/env node
// Temporary fix for @better-auth/oauth-provider: check refresh-token ownership
// BEFORE invalidating a revoked token's family. Reviewed versions: 1.7.18
// (2026-11-17) and 1.7.22 (2026-11-18, revokeRefreshToken byte-identical to
// 1.7.18). 1.7.25 still has the same ordering. Keep the provider's
// authentication, decoding and same-client replay handling intact; do not
// replace the endpoint.
// Remove this patch only after the real-provider revocation DB tests pass on a
// reviewed upstream fix. Unexpected versions/content must fail install/build.
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

// Each reviewed version pins its authorize module before and after the patch.
// Add a version only after diffing revokeRefreshToken against a reviewed one
// and running the real-provider revocation DB tests on it.
const reviewed = {
  "1.7.18": {
    original: "5f53ca87139e9a65355ed9798223c44bdd2e5fd3db3585e156f6aa2e87c599fd",
    patched: "f0446c2d492ef64370278b56303febd02263461553247c1b690e306612667936",
  },
  "1.7.22": {
    original: "b624c268c0ae186a2669e6df0d858bf3813355941c907f4db1192e0008bc9dfa",
    patched: "91efc21d407bfd0e8c3874e22c39314eae2bd770525984ea44a4fdda16f704a9",
  },
}
const digest = source => createHash("sha256").update(source).digest("hex")
const failure = () => new Error("OAuth revocation patch no longer matches the installed provider. Review the dependency and run the revocation DB tests before updating this patch.")

export function patchOAuthRevocation(packageDirectory) {
  const metadata = JSON.parse(readFileSync(join(packageDirectory, "package.json"), "utf8"))
  if (metadata.name !== "@better-auth/oauth-provider" || !Object.hasOwn(reviewed, metadata.version)) throw failure()
  const { original: originalDigest, patched: patchedDigest } = reviewed[metadata.version]
  const dist = join(packageDirectory, "dist")
  const candidates = readdirSync(dist).filter(name => /^authorize-.*\.mjs$/.test(name))
  if (candidates.length !== 1) throw failure()
  const target = join(dist, candidates[0])
  const source = readFileSync(target, "utf8")
  const currentDigest = digest(source)
  if (currentDigest === patchedDigest) return "already patched"
  if (currentDigest !== originalDigest) throw failure()

  const start = source.indexOf("async function revokeRefreshToken(")
  const end = source.indexOf("\n/**", start)
  const original = source.slice(start, end)
  const guard = "\tif (!refreshToken.clientId || refreshToken.clientId !== clientId) return null;\n"
  const patched = original.replace(guard, "").replace("\tif (refreshToken.revoked) {", `${guard}\tif (refreshToken.revoked) {`)
  const result = source.slice(0, start) + patched + source.slice(end)
  if (digest(result) !== patchedDigest) throw failure()
  writeFileSync(target, result)
  return "patched"
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Resolve from MCP, not from the app root: npm may nest its provider copy.
  const require = createRequire(import.meta.url)
  const mcpRequire = createRequire(require.resolve("@better-auth/mcp"))
  const providerDirectory = dirname(dirname(mcpRequire.resolve("@better-auth/oauth-provider")))
  console.log(`[oauth-revocation] ${patchOAuthRevocation(providerDirectory)}`)
}
