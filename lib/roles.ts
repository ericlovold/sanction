// Wallet member roles (WALLET-MEMBERS). Plain string union, not a DB enum —
// matches this schema's existing convention (see prisma/schema.prisma).
export type WalletRole = "owner" | "admin" | "viewer"

const RANK: Record<WalletRole, number> = { viewer: 0, admin: 1, owner: 2 }

// True when `role` meets or exceeds `min` on the owner > admin > viewer ladder.
export function hasRole(role: WalletRole, min: WalletRole): boolean {
  return RANK[role] >= RANK[min]
}
