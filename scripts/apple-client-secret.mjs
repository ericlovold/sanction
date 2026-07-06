#!/usr/bin/env node
// Mint the Sign-in-with-Apple client secret: an ES256 JWT signed with the .p8
// key from the Apple Developer portal. Apple caps its life at 6 months — we
// mint 180 days and you rotate the Vercel env var before it expires.
//
// Usage:
//   node scripts/apple-client-secret.mjs \
//     --team  <TEAM_ID>         (Apple Developer membership Team ID) \
//     --key   <KEY_ID>          (the Sign in with Apple key's Key ID) \
//     --client <SERVICES_ID>    (e.g. com.getsanction.auth) \
//     --p8    <path/to/AuthKey_XXXX.p8>
//
// Prints the JWT to stdout. Set it as APPLE_CLIENT_SECRET (and the Services ID
// as APPLE_CLIENT_ID). Never commit the .p8 or the minted secret.

import { readFileSync } from "node:fs"
import { SignJWT, importPKCS8 } from "jose"

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1]])
    return acc
  }, []),
)

const { team, key, client, p8 } = args
if (!team || !key || !client || !p8) {
  console.error("Usage: node scripts/apple-client-secret.mjs --team TEAM_ID --key KEY_ID --client SERVICES_ID --p8 AuthKey.p8")
  process.exit(1)
}

const privateKey = await importPKCS8(readFileSync(p8, "utf8"), "ES256")
const now = Math.floor(Date.now() / 1000)

const jwt = await new SignJWT({})
  .setProtectedHeader({ alg: "ES256", kid: key })
  .setIssuer(team) // Team ID
  .setSubject(client) // Services ID (= APPLE_CLIENT_ID)
  .setAudience("https://appleid.apple.com")
  .setIssuedAt(now)
  .setExpirationTime(now + 180 * 24 * 60 * 60) // 180 days — under Apple's 6-month cap
  .sign(privateKey)

console.log(jwt)
console.error(`\nExpires: ${new Date((now + 180 * 24 * 60 * 60) * 1000).toISOString().slice(0, 10)} — rotate APPLE_CLIENT_SECRET before then.`)
