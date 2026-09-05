import { randomUUID } from "node:crypto"
import { canonical } from "./auditChain"
import { encryptCredentialEnvelope, decryptCredentialEnvelope } from "./credentialCrypto"

export type ToolRequest = { tool: string; server?: string | null; arguments?: Record<string, unknown> }

// JSON-only, bounded before recursion/encryption. Order of object keys is not
// authority; array order, types, and values are. Missing arguments means {}.
export function canonicalToolRequest(request: ToolRequest): string {
  const value = { tool: request.tool, server: request.server ?? null, arguments: request.arguments ?? {} }
  const json = JSON.stringify(value)
  if (Buffer.byteLength(json, "utf8") > 64 * 1024) throw new Error("Tool request exceeds 64 KiB")
  function check(v: unknown, depth: number): void {
    if (depth > 32) throw new Error("Tool request exceeds 32 nesting levels")
    if (typeof v === "number" && !Number.isFinite(v)) throw new Error("Tool request contains a non-finite number")
    if (v && typeof v === "object") for (const item of Object.values(v)) check(item, depth + 1)
  }
  check(value, 0)
  return canonical(value)
}

export async function sealToolRequest(walletId: string, request: ToolRequest) {
  const label = `tool-approval:${randomUUID()}`
  const { blob, keyId } = await encryptCredentialEnvelope(canonicalToolRequest(request), walletId, label)
  return { version: 1, label, encryptedValue: blob, keyId }
}

export async function openToolRequest(walletId: string, resource: unknown): Promise<string | null> {
  const r = resource as { requestBinding?: { version?: unknown; label?: unknown; encryptedValue?: unknown; keyId?: unknown } } | null
  const b = r?.requestBinding
  if (!b || b.version !== 1 || typeof b.label !== "string" || !b.label.startsWith("tool-approval:") ||
      typeof b.encryptedValue !== "string" || typeof b.keyId !== "string") return null
  return decryptCredentialEnvelope({ walletId, label: b.label, encryptedValue: b.encryptedValue, keyId: b.keyId })
}
