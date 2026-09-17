// Display effective validity without mutating stored grant state during a read.
export function effectiveGrantStatus(grant: { status: string; consumedAt?: Date | null; expiresAt?: Date | null }, now: Date): string {
  if (grant.consumedAt) return "consumed"
  if (grant.status === "active" && grant.expiresAt && grant.expiresAt <= now) return "expired"
  return grant.status
}
