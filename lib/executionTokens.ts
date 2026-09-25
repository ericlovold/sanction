import { db } from "./db"

export type ExecutionTokenTx = Pick<typeof db, "executionToken">

// Kill switches (freeze, deactivate, key rotation) strand any execution JWT the
// agent already holds. Revoke them so the inject path refuses them at once
// instead of honoring them until their TTL runs out. Pass the kill switch's
// transaction client so the state change and the revocation commit together.
export function revokeActiveExecutionTokens(
  where: { agentId: string } | { walletId: string },
  tx: ExecutionTokenTx = db,
) {
  return tx.executionToken.updateMany({
    where: { ...where, status: "active" },
    data: { status: "revoked", revokedAt: new Date() },
  })
}
