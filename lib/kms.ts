import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto"

/**
 * KMS abstraction for envelope encryption (SEC-1).
 *
 * The system never encrypts credential values directly with the root key.
 * Instead each tenant (wallet) gets its own 256-bit Data Encryption Key (DEK).
 * Credential values are encrypted with the tenant DEK; the DEK itself is stored
 * WRAPPED (encrypted) by a root key that lives in a KMS. This is "envelope
 * encryption":
 *
 *     root key (KMS, never leaves)  --wraps-->     per-tenant DEK (stored wrapped)
 *     per-tenant DEK                --encrypts-->   credential value (stored)
 *
 * Why: blast-radius isolation + rotation. Compromising one tenant's unwrapped
 * DEK exposes only that tenant. Rotating the root key only requires re-wrapping
 * DEKs (cheap), not re-encrypting every credential. A `keyId` is stamped onto
 * every wrapped DEK and every ciphertext so multiple key versions can coexist.
 *
 * This interface is intentionally tiny so a real cloud KMS (AWS KMS, GCP KMS,
 * Vault transit, ...) can drop in WITHOUT touching any call site: implement
 * `wrapDek`/`unwrapDek` against the provider's encrypt/decrypt API and swap the
 * exported `kms` instance. We deliberately do NOT add an AWS SDK dependency now
 * (stack is Vercel/Neon, no AWS configured) -- the default is a software/local
 * provider that derives the root key from an env var.
 */
export interface Kms {
  /** Stable identifier of the root key version currently used for wrapping. */
  readonly rootKeyId: string

  /**
   * Wrap (encrypt) a raw DEK with the root key.
   * @param dek raw 32-byte data encryption key
   * @param aad additional authenticated data bound to the wrap (e.g. walletId)
   * @returns base64 wrapped blob
   */
  wrapDek(dek: Buffer, aad: string): Promise<string>

  /**
   * Unwrap (decrypt) a previously wrapped DEK.
   * @param wrapped base64 blob produced by `wrapDek`
   * @param aad must match the AAD used at wrap time, or this throws
   * @returns raw 32-byte DEK
   */
  unwrapDek(wrapped: string, aad: string): Promise<Buffer>
}

/** Length of a DEK in bytes (AES-256). */
export const DEK_BYTES = 32

/** Generate a fresh random DEK. */
export function generateDek(): Buffer {
  return randomBytes(DEK_BYTES)
}

// Wrapped-DEK blob layout (LocalKms):
//   [1-byte version=0x01] [iv(12)] [tag(16)] [ciphertext(32)]
// AAD binds the wrap to the tenant so a wrapped DEK can't be relocated to
// another wallet. The root key id is recorded separately (DB column) so it is
// queryable for rotation tooling.
const WRAP_V1 = 0x01

/**
 * Default software KMS. Root key is derived from
 * `SANCTION_KMS_ROOT_KEY` (preferred) or, for backward-compat with the original
 * single-key deployment, falls back to `SANCTION_CREDENTIAL_ENCRYPTION_KEY`.
 *
 * The env value is folded through SHA-256 to produce a 32-byte AES key (same
 * KDF substitute used historically -- acceptable as the env value is already
 * high-entropy base64). `rootKeyId` is a short, non-secret fingerprint of the
 * root key so rotation is observable and ciphertext/DEKs can name their key.
 */
export class LocalKms implements Kms {
  readonly rootKeyId: string
  #rootKey: Buffer

  constructor(rootKeyMaterial?: string) {
    const material =
      rootKeyMaterial ??
      process.env.SANCTION_KMS_ROOT_KEY ??
      process.env.SANCTION_CREDENTIAL_ENCRYPTION_KEY
    if (!material) {
      throw new Error(
        "No KMS root key: set SANCTION_KMS_ROOT_KEY (or legacy SANCTION_CREDENTIAL_ENCRYPTION_KEY)",
      )
    }
    this.#rootKey = createHash("sha256").update(material).digest()
    // Non-secret fingerprint: first 8 hex of sha256(rootKey). Identifies the key
    // version without revealing it. Prefixed so a future provider swap is clear.
    this.rootKeyId = "local:" + createHash("sha256").update(this.#rootKey).digest("hex").slice(0, 8)
  }

  async wrapDek(dek: Buffer, aad: string): Promise<string> {
    if (dek.length !== DEK_BYTES) throw new Error("DEK must be 32 bytes")
    const iv = randomBytes(12)
    const cipher = createCipheriv("aes-256-gcm", this.#rootKey, iv)
    cipher.setAAD(Buffer.from(aad, "utf8"))
    const enc = Buffer.concat([cipher.update(dek), cipher.final()])
    const tag = cipher.getAuthTag()
    return Buffer.concat([Buffer.from([WRAP_V1]), iv, tag, enc]).toString("base64")
  }

  async unwrapDek(wrapped: string, aad: string): Promise<Buffer> {
    const buf = Buffer.from(wrapped, "base64")
    if (buf[0] !== WRAP_V1) throw new Error("Unsupported wrapped-DEK version")
    const iv = buf.subarray(1, 13)
    const tag = buf.subarray(13, 29)
    const enc = buf.subarray(29)
    const decipher = createDecipheriv("aes-256-gcm", this.#rootKey, iv)
    decipher.setAAD(Buffer.from(aad, "utf8"))
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(enc), decipher.final()])
  }
}

// Lazily-constructed singleton so importing this module never throws at load
// time (env may not be set in every context, e.g. type-checking).
let _kms: Kms | null = null

/** The active KMS provider. Swap the construction here to use a real KMS. */
export function getKms(): Kms {
  if (!_kms) _kms = new LocalKms()
  return _kms
}

/** Test/override hook: inject a KMS implementation (e.g. a mock cloud KMS). */
export function setKms(kms: Kms | null): void {
  _kms = kms
}
