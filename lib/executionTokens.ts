import type { Prisma } from "./generated/prisma/client"

export type ExecutionTokenTx = Pick<Prisma.TransactionClient, "executionToken">

// Kill switches (freeze, deactivate, key rotation) strand any execution JWT the
// agent already holds. Revoke them so the inject path refuses them at once
// instead of honoring them until their TTL runs out. Pass the kill switch's
// tenant-scoped transaction client so the state change and revocation commit
// together. Callers must scope to the authenticated wallet(s) before calling.
export function revokeActiveExecutionTokens(
  where: { agentId: string } | { walletId: string },
  tx: ExecutionTokenTx,
) {
  return tx.executionToken.updateMany({
    where: { ...where, status: "active" },
    data: { status: "revoked", revokedAt: new Date() },
  })
}
