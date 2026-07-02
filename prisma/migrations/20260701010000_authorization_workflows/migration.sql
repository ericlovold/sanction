-- Generic human authorization workflow primitives.
-- PendingApproval is the owner-facing request; Grant is the ephemeral authority
-- issued from an approval. Existing spend AuthorizationRequest rows remain for
-- API compatibility and audit continuity.
ALTER TABLE "Webhook"
  ALTER COLUMN "events" SET DEFAULT ARRAY['approval.created', 'approval.resolved', 'escalation.created', 'escalation.resolved']::TEXT[];

CREATE TABLE "PendingApproval" (
  "id" TEXT NOT NULL,
  "walletId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "actionType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "subjectJson" JSONB NOT NULL,
  "resourceJson" JSONB NOT NULL,
  "constraintsJson" JSONB,
  "reason" TEXT,
  "code" TEXT,
  "sourceType" TEXT,
  "sourceId" TEXT,
  "expiresAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "resolvedBy" TEXT,
  "resolutionNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PendingApproval_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Grant" (
  "id" TEXT NOT NULL,
  "walletId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "actionType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "subjectJson" JSONB NOT NULL,
  "resourceJson" JSONB NOT NULL,
  "constraintsJson" JSONB,
  "sourceType" TEXT,
  "sourceId" TEXT,
  "issuedBy" TEXT,
  "issuedFromApprovalId" TEXT,
  "justification" TEXT,
  "expiresAt" TIMESTAMP(3),
  "consumedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Grant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PendingApproval_sourceType_sourceId_key"
  ON "PendingApproval"("sourceType", "sourceId");
CREATE INDEX "PendingApproval_walletId_status_createdAt_idx"
  ON "PendingApproval"("walletId", "status", "createdAt");
CREATE INDEX "PendingApproval_agentId_createdAt_idx"
  ON "PendingApproval"("agentId", "createdAt");
CREATE INDEX "PendingApproval_actionType_status_idx"
  ON "PendingApproval"("actionType", "status");

CREATE INDEX "Grant_walletId_status_createdAt_idx"
  ON "Grant"("walletId", "status", "createdAt");
CREATE INDEX "Grant_agentId_createdAt_idx"
  ON "Grant"("agentId", "createdAt");
CREATE INDEX "Grant_actionType_status_idx"
  ON "Grant"("actionType", "status");
CREATE INDEX "Grant_issuedFromApprovalId_idx"
  ON "Grant"("issuedFromApprovalId");
CREATE INDEX "Grant_sourceType_sourceId_idx"
  ON "Grant"("sourceType", "sourceId");

ALTER TABLE "PendingApproval"
  ADD CONSTRAINT "PendingApproval_walletId_fkey"
  FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PendingApproval"
  ADD CONSTRAINT "PendingApproval_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Grant"
  ADD CONSTRAINT "Grant_walletId_fkey"
  FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Grant"
  ADD CONSTRAINT "Grant_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Grant"
  ADD CONSTRAINT "Grant_issuedFromApprovalId_fkey"
  FOREIGN KEY ("issuedFromApprovalId") REFERENCES "PendingApproval"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill pending spend approvals for any unresolved legacy escalations.
INSERT INTO "PendingApproval" (
  "id", "walletId", "agentId", "actionType", "status", "subjectJson", "resourceJson",
  "constraintsJson", "reason", "code", "sourceType", "sourceId", "expiresAt",
  "createdAt", "updatedAt"
)
SELECT
  'pa_' || ar."id",
  a."walletId",
  ar."agentId",
  'spend.' || ar."action",
  'pending',
  jsonb_build_object('agent_id', ar."agentId", 'agent_name', a."name"),
  jsonb_build_object(
    'kind', 'spend',
    'action', ar."action",
    'amount_usd', ar."amountUsd",
    'merchant', ar."merchant",
    'category', ar."category",
    'description', ar."description"
  ),
  jsonb_build_object(
    'one_use', true,
    'grant_ttl_mins', 15,
    'timeout_mins', p."escalationTimeoutMins",
    'timeout_action', p."escalationTimeoutAction"
  ),
  COALESCE(ar."decisionNote", 'Exceeds escalation threshold'),
  'ESCALATION_REQUIRED',
  'authorization_request',
  ar."id",
  CASE
    WHEN p."escalationTimeoutMins" > 0 THEN ar."createdAt" + (p."escalationTimeoutMins" || ' minutes')::interval
    ELSE NULL
  END,
  ar."createdAt",
  now()
FROM "AuthorizationRequest" ar
JOIN "Agent" a ON a."id" = ar."agentId"
LEFT JOIN "Policy" p ON p."walletId" = a."walletId"
WHERE ar."status" = 'escalated'
ON CONFLICT ("sourceType", "sourceId") DO NOTHING;
