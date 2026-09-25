// Wallet freeze (KILL-1) — the owner's one-control stop for a wallet subtree.
//
// A frozen wallet, or any frozen ancestor, denies every data-plane action with
// WALLET_FROZEN until unfrozen. Enforcement is a single recursive ancestor walk
// (depth-capped like cascadeBudget) called by each data-plane route right after
// agent auth — explicit at every gate, per the atomic-authorization principle.

import { db } from "./db"

export const WALLET_FROZEN_NOTE = "Wallet is frozen"
export const PARENT_FROZEN_NOTE = "Parent wallet is frozen"
export const HIERARCHY_UNVERIFIED_NOTE = "Wallet hierarchy could not be verified"

const MAX_ANCESTOR_DEPTH = 16

export type FreezeTx = Pick<typeof db, "wallet">

export type FreezeState =
  | { frozen: false }
  | { frozen: true; frozenWalletId: string; self: boolean; reason: string | null; unverified?: true }

// Fail closed: a walk that cannot reach a root (missing ancestor, parent cycle,
// depth cap) cannot prove no ancestor is frozen, so it denies like a freeze.
function unverified(walletId: string): FreezeState {
  return { frozen: true, frozenWalletId: walletId, self: true, reason: null, unverified: true }
}

/** Walk the wallet's ancestor chain; report the first frozen wallet found. */
export async function walletFreezeState(tx: FreezeTx, walletId: string): Promise<FreezeState> {
  const seen = new Set<string>()
  let cur: string | null = walletId

  for (let depth = 0; cur; depth++) {
    if (depth >= MAX_ANCESTOR_DEPTH || seen.has(cur)) return unverified(walletId)
    seen.add(cur)
    const wallet: { id: string; parentId: string | null; frozenAt: Date | null; frozenReason: string | null } | null =
      await tx.wallet.findUnique({
        where: { id: cur },
        select: { id: true, parentId: true, frozenAt: true, frozenReason: true },
      })
    if (!wallet) return unverified(walletId)
    if (wallet.frozenAt) {
      return { frozen: true, frozenWalletId: wallet.id, self: wallet.id === walletId, reason: wallet.frozenReason }
    }
    cur = wallet.parentId
  }
  return { frozen: false }
}

/** The decisionNote for a frozen denial — the decisionCode contract string. */
export function frozenNote(state: Extract<FreezeState, { frozen: true }>): string {
  if (state.unverified) return HIERARCHY_UNVERIFIED_NOTE
  return state.self ? WALLET_FROZEN_NOTE : PARENT_FROZEN_NOTE
}

/**
 * Derive freeze state from an already-fetched ancestor chain (cascadeBudget's
 * walk, leaf-first) — the zero-extra-queries path for routes that fetch it.
 * A chain whose last node still names a parent was truncated (missing
 * ancestor, cycle, or depth cap) and fails closed like walletFreezeState.
 */
export function freezeStateFromChain(
  chain: Array<{ id: string; parentId?: string | null; frozenAt?: Date | null; frozenReason?: string | null }>,
  walletId: string,
): FreezeState {
  for (const node of chain) {
    if (node.frozenAt) {
      return { frozen: true, frozenWalletId: node.id, self: node.id === walletId, reason: node.frozenReason ?? null }
    }
  }
  if (chain.length > 0 && chain[chain.length - 1].parentId != null) return unverified(walletId)
  return { frozen: false }
}
