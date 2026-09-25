import { db } from "./db"

// Kill switches (freeze, deactivate, key rotation) strand any execution JWT the
// agent already holds. Revoke them so the inject path refuses them at once
// instead of honoring them until their TTL runs out.
export function revokeActiveExecutionTokens(where: { agentId: string } | { walletId: string }) {
  return db.executionToken.updateMany({
    where: { ...where, status: "active" },
    data: { status: "revoked", revokedAt: new Date() },
  })
}
