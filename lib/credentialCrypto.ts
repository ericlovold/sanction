import { randomBytes, createCipheriv, createDecipheriv } from "crypto"
import { db } from "@/lib/db"
import { decryptCredential } from "@/lib/jwt"
import { generateDataKey, unwrapDataKey } from "@/lib/kms"

// SEC-1 envelope encryption (ciphertext V3).
//
// V3 layout (base64):  0x03 ‖ IV(12) ‖ tag(16) ‖ ciphertext
// AES-256-GCM under a per-wallet DEK (random, KMS-wrapped — see lib/kms.ts), with
// the same AAD contract as V2: "${walletId}:${label}". The wrapping key is named
// by the credential's keyId column (→ WalletKey.id), so a V3 blob is only readable
// with a live KMS unwrap, not from the database alone.

const CIPHERTEXT_V3 = 0x03

// In-process plaintext-DEK cache, keyed by WalletKey id, so injects don't hit KMS
// on every call. Bounded + TTL; warm serverless instances reuse it.
const DEK_TTL_MS = 5 * 60_000
const DEK_MAX = 256
const dekCache = new Map<string, { dek: Buffer; exp: number }>()

function cacheGet(id: string): Buffer | null {
  const e = dekCache.get(id)
  if (!e) return null
  if (e.exp < Date.now()) {
    dekCache.delete(id)
    return null
  }
  return e.dek
}
function cacheSet(id: string, dek: Buffer): void {
  if (dekCache.size >= DEK_MAX) {
    const oldest = dekCache.keys().next().value
    if (oldest) dekCache.delete(oldest)
  }
  dekCache.set(id, { dek, exp: Date.now() + DEK_TTL_MS })
}

// Pure V3 crypto with a caller-supplied DEK — no DB/KMS, so it's unit-testable.
export function encryptV3(plaintext: string, dek: Buffer, walletId: string, label: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", dek, iv)
  cipher.setAAD(Buffer.from(`${walletId}:${label}`, "utf8"))
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([Buffer.from([CIPHERTEXT_V3]), iv, tag, enc]).toString("base64")
}

export function decryptV3(blob: string, dek: Buffer, walletId: string, label: string): string {
  const buf = Buffer.from(blob, "base64")
  const iv = buf.subarray(1, 13)
  const tag = buf.subarray(13, 29)
  const enc = buf.subarray(29)
  const d = createDecipheriv("aes-256-gcm", dek, iv)
  d.setAAD(Buffer.from(`${walletId}:${label}`, "utf8"))
  d.setAuthTag(tag)
  return d.update(enc) + d.final("utf8")
}

// Get (or lazily mint) the wallet's plaintext DEK + the keyId to stamp on writes.
async function getWalletDek(walletId: string): Promise<{ dek: Buffer; keyId: string }> {
  let wk = await db.walletKey.findUnique({ where: { walletId } })
  if (!wk) {
    const gen = await generateDataKey()
    try {
      wk = await db.walletKey.create({ data: { walletId, wrappedDek: gen.wrappedDek, keyRef: gen.keyRef } })
      cacheSet(wk.id, gen.plaintextDek)
      return { dek: gen.plaintextDek, keyId: wk.id }
    } catch (e: unknown) {
      // Concurrent create lost the unique(walletId) race — fall through to re-read.
      const code = typeof e === "object" && e && "code" in e ? (e as { code?: string }).code : undefined
      if (code !== "P2002") throw e
      wk = await db.walletKey.findUnique({ where: { walletId } })
    }
  }
  if (!wk) throw new Error("WalletKey unavailable")
  const cached = cacheGet(wk.id)
  if (cached) return { dek: cached, keyId: wk.id }
  const dek = await unwrapDataKey(wk.wrappedDek, wk.keyRef)
  cacheSet(wk.id, dek)
  return { dek, keyId: wk.id }
}

// Encrypt a credential under the wallet's KMS-wrapped DEK (writes V3).
export async function encryptCredentialEnvelope(
  plaintext: string,
  walletId: string,
  label: string,
): Promise<{ blob: string; keyId: string }> {
  const { dek, keyId } = await getWalletDek(walletId)
  return { blob: encryptV3(plaintext, dek, walletId, label), keyId }
}

type StoredCredential = { encryptedValue: string; walletId: string; label: string; keyId: string | null }

// Decrypt a stored credential. V3 (keyId set) unwraps the wallet DEK via KMS;
// pre-V3 blobs (keyId null) use the existing synchronous V2/V1/V0 fallthrough.
export async function decryptCredentialEnvelope(cred: StoredCredential): Promise<string> {
  const buf = Buffer.from(cred.encryptedValue, "base64")
  if (!cred.keyId || buf[0] !== CIPHERTEXT_V3) {
    return decryptCredential(cred.encryptedValue, cred.walletId, cred.label)
  }
  const wk = await db.walletKey.findUnique({ where: { id: cred.keyId } })
  if (!wk) throw new Error("WalletKey not found for credential")
  const cached = cacheGet(wk.id)
  const dek = cached ?? (await unwrapDataKey(wk.wrappedDek, wk.keyRef))
  if (!cached) cacheSet(wk.id, dek)
  return decryptV3(cred.encryptedValue, dek, cred.walletId, cred.label)
}
