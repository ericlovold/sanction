-- Reconcile production's execution policies with the app.wallet_ids scope
-- used by withTenant/scopeTenant, including authorized subtree reads. Keep
-- protection enabled throughout; policy replacement commits atomically.
BEGIN;

ALTER TABLE "ExecutionToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExecutionToken" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ExecutionToken_tenant_isolation" ON "ExecutionToken";
DROP POLICY IF EXISTS "tenant_isolation" ON "ExecutionToken";
CREATE POLICY "tenant_isolation" ON "ExecutionToken"
  USING ("walletId" = ANY(string_to_array(current_setting('app.wallet_ids', true), ',')))
  WITH CHECK ("walletId" = ANY(string_to_array(current_setting('app.wallet_ids', true), ',')));

ALTER TABLE "CredentialInjection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CredentialInjection" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "CredentialInjection_tenant_isolation" ON "CredentialInjection";
DROP POLICY IF EXISTS "tenant_isolation" ON "CredentialInjection";
-- Both references must belong to the same wallet, even when the caller has
-- an authorized subtree scope. Foreign-key checks alone do not enforce RLS.
CREATE POLICY "tenant_isolation" ON "CredentialInjection"
  USING (EXISTS (
    SELECT 1 FROM "ExecutionToken" et
    JOIN "CredentialVault" cv ON cv.id = "CredentialInjection"."credentialId"
      AND cv."walletId" = et."walletId"
    WHERE et.id = "CredentialInjection"."executionTokenId"
      AND et."walletId" = ANY(string_to_array(current_setting('app.wallet_ids', true), ','))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "ExecutionToken" et
    JOIN "CredentialVault" cv ON cv.id = "CredentialInjection"."credentialId"
      AND cv."walletId" = et."walletId"
    WHERE et.id = "CredentialInjection"."executionTokenId"
      AND et."walletId" = ANY(string_to_array(current_setting('app.wallet_ids', true), ','))
  ));

-- The canonical vault membership policy already exists. Remove only the
-- redundant permissive production policy using the obsolete single-wallet GUC.
DROP POLICY IF EXISTS "CredentialVault_tenant_isolation" ON "CredentialVault";

-- TenantKey exists only in production and has no model in this application.
-- Its existing RLS protection is deliberately left untouched.
COMMIT;
