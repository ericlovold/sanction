-- Make escalation reachable on the default policy.
-- Before: autoApproveUnderUsd=2500 ($25), escalateOverUsd=10000 ($100) while
-- perTransactionMaxUsd=5000 ($50). Because /authorize denies over the per-txn
-- cap BEFORE checking escalation, status="escalated" was unreachable on a fresh
-- wallet (escalateOver $100 > perTxn $50). New defaults keep the ladder ordered
-- autoApproveUnder <= escalateOver < perTransactionMax so escalation can fire.
--
-- Only the column DEFAULT changes (applies to wallets created from here on).
-- Existing Policy rows keep their configured values; no data is rewritten.
ALTER TABLE "Policy" ALTER COLUMN "autoApproveUnderUsd" SET DEFAULT 1000;
ALTER TABLE "Policy" ALTER COLUMN "escalateOverUsd" SET DEFAULT 2500;
