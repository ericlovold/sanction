import { createHash, randomBytes } from "crypto"

export function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const raw = `pxy_${randomBytes(32).toString("hex")}`
  const hash = createHash("sha256").update(raw).digest("hex")
  const prefix = raw.slice(0, 12)
  return { raw, hash, prefix }
}

export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex")
}
