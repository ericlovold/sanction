import { createCipheriv, createDecipheriv, randomBytes } from "crypto"
import { withTenant } from "./tenantDb"
import { getKms, generateDek } from "./kms"
import { decryptCredential as decryptLegacyOrV1 } from "./jwt"

/**
 * Envelope encryption for credential values (SEC-1).
 *
 * Layering:
 *   - `lib/kms.ts`  : root key wraps/unwraps per-tenant DEKs (pluggable).
 *   - this module   : manages per-wallet DEKs (create/cache/unwrap) and does
 *                     the actual value encrypt/decrypt with the tenant DEK.
 *   - `lib/jwt.ts`  : legacy global-key crypto, kept ONLY as the decrypt
 *                     fallback for pre-envelope (v1 / unversioned) blobs.
 *
 * Ciphertext format v2 (envelope):
 *   base64( [0x02] [keyIdLen(1)] [keyId(utf8, keyIdLen bytes)] [iv(12)] [tag(16)] [ct] )
 * The keyId names the TenantKey/DEK the value was encrypted under, so decryption
 * can fetch+unwrap exactly the right DEK and tenants can rotate DEKs without a
 * bulk re-encrypt. AAD = `${walletId}:${label}` exactly as before, preserving
 * the tenant/label binding (a blob can't be replayed under another wallet/label).
 *
 * Backward compatibility: `decryptCredentialValue` recognizes the 0x02 prefix
 * and routes everything else (0x01 v1, or unversioned legacy) to the global-key
 * path in lib/jwt.ts. New writes always use v2, so values upgrade lazily on the
 * next store/rotation.
 */

const CIPHERTEXT_V2 = 0x02

// In-process cache of unwrapped DEKs, keyed by `${walletId}:${keyId}`. Avoids a
// KMS round-trip per inject. Serverless instances are short-lived, bounding the
// window an unwrapped DEK lives in memory. Cleared on demand for tests.
const dekCache = new Map<string, Buffer>()

/** Wrap-AAD binds a wrapped DEK to its wallet (and keyId) so it can't be moved. */
function wrapAad(walletId: string, keyId: string): string {
  return `dek:${walletId}:${keyId}`
}

/**
 * Get (or lazily create) the ACTIVE tenant key record for a wallet, returning
 * its keyId and the raw (unwrapped) DEK.
 *
 * Concurrency: two parallel first-writes could both try to create the initial
 * DEK. The `@@unique([walletId, keyId])` constraint makes the loser's insert
 * fail; we catch and re-read. Result is at-most-one active DEK per wallet.
 */
async function getActiveDek(walletId: string): Promise<{ keyId: string; dek: Buffer }> {
  // TenantKey has FORCED RLS (SEC-3) — all access must run inside the wallet's
  // tenant context, or the DB returns/accepts zero rows (fail-closed).
  const rec = await withTenant(walletId, async (tx) => {
    let row = await tx.tenantKey.findFirst({
      where: { walletId, isActive: true },
      orderBy: { createdAt: "desc" },
    })
    if (row) return row

    const kms = getKms()
    const keyId = "dek_" + randomBytes(8).toString("hex")
    const dek = generateDek()
    const wrappedDek = await kms.wrapDek(dek, wrapAad(walletId, keyId))
    try {
      row = await tx.tenantKey.create({
        data: { walletId, keyId, wrappedDek, rootKeyId: kms.rootKeyId, isActive: true },
      })
    } catch {
      // Lost a creation race (unique violation) — another writer created the
      // active DEK first. Re-read it.
      row = await tx.tenantKey.findFirst({
        where: { walletId, isActive: true },
        orderBy: { createdAt: "desc" },
      })
      if (!row) throw new Error(`Failed to establish tenant DEK for wallet ${walletId}`)
    }
    return row
  })

  const dek = await unwrapTenantDek(rec.walletId, rec.keyId, rec.wrappedDek)
  return { keyId: rec.keyId, dek }
}

/** Fetch + unwrap a specific tenant DEK by keyId (used on decrypt). */
async function getDekByKeyId(walletId: string, keyId: string): Promise<Buffer> {
  const cacheKey = `${walletId}:${keyId}`
  const cached = dekCache.get(cacheKey)
  if (cached) return cached
  const rec = await withTenant(walletId, (tx) =>
    tx.tenantKey.findUnique({ where: { walletId_keyId: { walletId, keyId } } }),
  )
  if (!rec) throw new Error(`Tenant DEK not found: ${walletId}/${keyId}`)
  return unwrapTenantDek(walletId, keyId, rec.wrappedDek)
}

async function unwrapTenantDek(walletId: string, keyId: string, wrappedDek: string): Promise<Buffer> {
  const cacheKey = `${walletId}:${keyId}`
  const cached = dekCache.get(cacheKey)
  if (cached) return cached
  const dek = await getKms().unwrapDek(wrappedDek, wrapAad(walletId, keyId))
  dekCache.set(cacheKey, dek)
  return dek
}

/**
 * Encrypt a credential value under the wallet's active DEK (envelope v2).
 * Lazily creates the wallet's DEK on first use.
 *
 * @returns { ciphertext (base64 v2 blob), keyId } — persist both; keyId on the
 *   CredentialVault row makes the DEK queryable for rotation tooling.
 */
export async function encryptCredentialValue(
  walletId: string,
  label: string,
  plaintext: string,
): Promise<{ ciphertext: string; keyId: string }> {
  const { keyId, dek } = await getActiveDek(walletId)
  const aad = `${walletId}:${label}`

  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", dek, iv)
  cipher.setAAD(Buffer.from(aad, "utf8"))
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()

  const keyIdBuf = Buffer.from(keyId, "utf8")
  if (keyIdBuf.length > 255) throw new Error("keyId too long")
  const blob = Buffer.concat([
    Buffer.from([CIPHERTEXT_V2, keyIdBuf.length]),
    keyIdBuf,
    iv,
    tag,
    enc,
  ])
  return { ciphertext: blob.toString("base64"), keyId }
}

/**
 * Decrypt a credential value. Handles all formats:
 *   - v2 (0x02): envelope — unwrap the named tenant DEK, then AES-256-GCM.
 *   - v1 / legacy: delegate to the global-key path in lib/jwt.ts.
 *
 * @param walletId tenant the value belongs to (for AAD + DEK lookup)
 * @param label    credential label (for AAD)
 */
export async function decryptCredentialValue(
  walletId: string,
  label: string,
  ciphertext: string,
): Promise<string> {
  const buf = Buffer.from(ciphertext, "base64")

  if (buf[0] === CIPHERTEXT_V2) {
    const keyIdLen = buf[1]
    const keyId = buf.subarray(2, 2 + keyIdLen).toString("utf8")
    const rest = buf.subarray(2 + keyIdLen)
    const iv = rest.subarray(0, 12)
    const tag = rest.subarray(12, 28)
    const enc = rest.subarray(28)
    const dek = await getDekByKeyId(walletId, keyId)
    const decipher = createDecipheriv("aes-256-gcm", dek, iv)
    decipher.setAAD(Buffer.from(`${walletId}:${label}`, "utf8"))
    decipher.setAuthTag(tag)
    return decipher.update(enc) + decipher.final("utf8")
  }

  // v1 / unversioned legacy: global-key fallback (lazy upgrade happens on the
  // next write, which goes through encryptCredentialValue → v2).
  return decryptLegacyOrV1(ciphertext, `${walletId}:${label}`)
}

/** Test hook: drop the in-process unwrapped-DEK cache. */
export function clearDekCache(): void {
  dekCache.clear()
}
