-- SEC-3 Phase 2 (Step 0): switch the credential-vault RLS policy from a single
-- app.wallet_id GUC to a membership-list app.wallet_ids (comma-joined). The same
-- policy form then serves both single-tenant access and account-tree subtree
-- reads (a parent sets the whole subtree's ids). Unset GUC -> string_to_array
-- returns NULL -> "= ANY(NULL)" -> no rows = fail-closed (unchanged from Phase 1).
DROP POLICY IF EXISTS "tenant_isolation" ON "CredentialVault";
CREATE POLICY "tenant_isolation" ON "CredentialVault"
  USING ("walletId" = ANY(string_to_array(current_setting('app.wallet_ids', true), ',')))
  WITH CHECK ("walletId" = ANY(string_to_array(current_setting('app.wallet_ids', true), ',')));
