import { randomBytes, createCipheriv, createDecipheriv, createHash } from "crypto"

// SEC-1 envelope-encryption key root.
//
// In production, SANCTION_KMS_KEY_ARN points at an AWS KMS key that wraps each
// wallet's data-encryption key (DEK). The DEK's plaintext never persists, and
// unwrapping it requires a live, CloudTrail-logged KMS call with the scoped IAM
// credentials — so a database dump OR an env-var leak ALONE can no longer decrypt
// the vault (the threat SEC-1 exists to close), and access is instantly revocable.
//
// When SANCTION_KMS_KEY_ARN is unset (local, CI, preview), DEKs are wrapped with
// the existing env master so the envelope path is fully exercisable without AWS.
// The security boundary only changes in production, by design.

const KEY_ARN = process.env.SANCTION_KMS_KEY_ARN

export type GeneratedKey = { plaintextDek: Buffer; wrappedDek: string; keyRef: string }

// Lazily-loaded singleton KMS client — only constructed when a real ARN is set,
// so local/CI/preview never need @aws-sdk/client-kms at runtime.
let kmsClientPromise: Promise<import("@aws-sdk/client-kms").KMSClient> | null = null
async function getKmsClient() {
  if (!kmsClientPromise) {
    kmsClientPromise = import("@aws-sdk/client-kms").then(({ KMSClient }) => new KMSClient({}))
  }
  return kmsClientPromise
}

function localMaster(): Buffer {
  const key = process.env.SANCTION_CREDENTIAL_ENCRYPTION_KEY
  if (!key) throw new Error("SANCTION_CREDENTIAL_ENCRYPTION_KEY not set")
  return createHash("sha256").update(key).digest()
}

// AES-256-GCM wrap/unwrap of a DEK under the env master — local fallback only.
function localWrap(dek: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", localMaster(), iv)
  const enc = Buffer.concat([cipher.update(dek), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString("base64")
}
function localUnwrap(wrapped: string): Buffer {
  const buf = Buffer.from(wrapped, "base64")
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const enc = buf.subarray(28)
  const d = createDecipheriv("aes-256-gcm", localMaster(), iv)
  d.setAuthTag(tag)
  return Buffer.concat([d.update(enc), d.final()])
}

// Mint a fresh 256-bit DEK and return it both in plaintext (to use immediately)
// and wrapped (to persist). Uses KMS GenerateDataKey in prod, env-master locally.
export async function generateDataKey(): Promise<GeneratedKey> {
  if (KEY_ARN) {
    const { GenerateDataKeyCommand } = await import("@aws-sdk/client-kms")
    const client = await getKmsClient()
    const out = await client.send(new GenerateDataKeyCommand({ KeyId: KEY_ARN, KeySpec: "AES_256" }))
    return {
      plaintextDek: Buffer.from(out.Plaintext as Uint8Array),
      wrappedDek: Buffer.from(out.CiphertextBlob as Uint8Array).toString("base64"),
      keyRef: KEY_ARN,
    }
  }
  const dek = randomBytes(32)
  return { plaintextDek: dek, wrappedDek: localWrap(dek), keyRef: "local" }
}

// Recover a wrapped DEK's plaintext. keyRef "local" → env master; anything else
// is treated as a KMS key and unwrapped via KMS Decrypt.
export async function unwrapDataKey(wrappedDek: string, keyRef: string): Promise<Buffer> {
  if (keyRef !== "local") {
    const { DecryptCommand } = await import("@aws-sdk/client-kms")
    const client = await getKmsClient()
    const out = await client.send(
      new DecryptCommand({ CiphertextBlob: Buffer.from(wrappedDek, "base64"), KeyId: keyRef }),
    )
    return Buffer.from(out.Plaintext as Uint8Array)
  }
  return localUnwrap(wrappedDek)
}
