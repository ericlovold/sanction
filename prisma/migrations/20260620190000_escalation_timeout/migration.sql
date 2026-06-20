-- Escalation deadlock guard (UX-2). An escalated authorization that no human
-- resolves within escalationTimeoutMins is settled to the fallback terminal
-- state on the next read. 0 = wait indefinitely; default action is fail-closed.
-- New columns carry defaults so existing Policy rows backfill safely.
ALTER TABLE "Policy" ADD COLUMN "escalationTimeoutMins" INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "Policy" ADD COLUMN "escalationTimeoutAction" TEXT NOT NULL DEFAULT 'deny';
