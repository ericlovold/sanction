-- SEC-3 Phase 2a: RLS on AgentClearance (has a direct walletId column).
ALTER TABLE "AgentClearance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentClearance" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "AgentClearance"
  USING ("walletId" = ANY(string_to_array(current_setting('app.wallet_ids', true), ',')))
  WITH CHECK ("walletId" = ANY(string_to_array(current_setting('app.wallet_ids', true), ',')));
