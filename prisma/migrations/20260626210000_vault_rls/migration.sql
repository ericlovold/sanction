-- SEC-3: Row-Level Security on the credential vault (the crown-jewel table).
-- FORCE makes even the table owner subject to RLS (Neon's app role is a
-- non-superuser owner). The app sets app.wallet_id per request via withTenant().
ALTER TABLE "CredentialVault" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CredentialVault" FORCE ROW LEVEL SECURITY;

-- Reads and writes are confined to the current tenant. When app.wallet_id is
-- unset, current_setting(...,true) returns NULL and no row matches → fail-closed.
CREATE POLICY "tenant_isolation" ON "CredentialVault"
  USING ("walletId" = current_setting('app.wallet_id', true))
  WITH CHECK ("walletId" = current_setting('app.wallet_id', true));
