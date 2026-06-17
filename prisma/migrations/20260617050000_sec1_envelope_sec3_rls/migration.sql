-- =============================================================================
-- SEC-1  Envelope encryption (per-tenant DEKs)  +  SEC-3  Postgres RLS
-- =============================================================================
-- This migration does two security-gate items:
--   SEC-1: a TenantKey table to hold each wallet's wrapped Data Encryption Key,
--          and a nullable keyId column on CredentialVault naming the DEK a value
--          was encrypted under (the ciphertext is self-describing; the column
--          makes it queryable for rotation tooling).
--   SEC-3: Row-Level Security on tenant-scoped tables, with policies keyed on a
--          per-transaction session setting `app.current_wallet` (set by
--          lib/tenantDb.ts via set_config(...,true)).
--
-- OPERATIONAL PRECONDITION (SEC-3): the application's Postgres role MUST NOT be
-- a superuser and MUST NOT have the BYPASSRLS attribute, or these policies are
-- silently skipped. On Neon, the default app role is non-superuser; verify with
--   SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;
-- Table owners also bypass RLS unless FORCE ROW LEVEL SECURITY is set, so we
-- FORCE it below to cover the case where the app role owns these tables (it does
-- under Prisma migrate). This is intentional and required for correctness.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- SEC-1: per-tenant DEK storage
-- ----------------------------------------------------------------------------
CREATE TABLE "TenantKey" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "wrappedDek" TEXT NOT NULL,
    "rootKeyId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotatedAt" TIMESTAMP(3),

    CONSTRAINT "TenantKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenantKey_walletId_keyId_key" ON "TenantKey"("walletId", "keyId");
CREATE INDEX "TenantKey_walletId_isActive_idx" ON "TenantKey"("walletId", "isActive");

ALTER TABLE "TenantKey" ADD CONSTRAINT "TenantKey_walletId_fkey"
    FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- keyId on the credential row (nullable: legacy/v1 blobs have no DEK and stay NULL)
ALTER TABLE "CredentialVault" ADD COLUMN "keyId" TEXT;

-- ----------------------------------------------------------------------------
-- SEC-3: Row-Level Security
-- ----------------------------------------------------------------------------
-- Helper note: current_setting('app.current_wallet', true) returns NULL when
-- the setting is unset (the `true` = missing_ok). A NULL current wallet matches
-- no row, so any query that forgot to open a tenant context reads nothing
-- (fail-closed) rather than everything.

-- CredentialVault (converted: vault + inject routes) -------------------------
ALTER TABLE "CredentialVault" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CredentialVault" FORCE ROW LEVEL SECURITY;
CREATE POLICY "CredentialVault_tenant_isolation" ON "CredentialVault"
    USING ("walletId" = current_setting('app.current_wallet', true))
    WITH CHECK ("walletId" = current_setting('app.current_wallet', true));

-- TenantKey (DEKs are per-tenant secrets — must never cross tenants) ----------
ALTER TABLE "TenantKey" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantKey" FORCE ROW LEVEL SECURITY;
CREATE POLICY "TenantKey_tenant_isolation" ON "TenantKey"
    USING ("walletId" = current_setting('app.current_wallet', true))
    WITH CHECK ("walletId" = current_setting('app.current_wallet', true));

-- ExecutionToken (read on inject) --------------------------------------------
ALTER TABLE "ExecutionToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExecutionToken" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ExecutionToken_tenant_isolation" ON "ExecutionToken"
    USING ("walletId" = current_setting('app.current_wallet', true))
    WITH CHECK ("walletId" = current_setting('app.current_wallet', true));

-- CredentialInjection (audit write on inject) --------------------------------
-- No direct walletId; isolate via the parent ExecutionToken's wallet.
ALTER TABLE "CredentialInjection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CredentialInjection" FORCE ROW LEVEL SECURITY;
CREATE POLICY "CredentialInjection_tenant_isolation" ON "CredentialInjection"
    USING (EXISTS (
        SELECT 1 FROM "ExecutionToken" et
        WHERE et."id" = "CredentialInjection"."executionTokenId"
          AND et."walletId" = current_setting('app.current_wallet', true)
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM "ExecutionToken" et
        WHERE et."id" = "CredentialInjection"."executionTokenId"
          AND et."walletId" = current_setting('app.current_wallet', true)
    ));

-- The following tenant tables have RLS enabled now for defense-in-depth, but
-- their routes are NOT yet converted to withTenant() (tracked in
-- docs/SECURITY-FINDINGS.md). They are keyed directly on walletId.
-- NOTE: enabling RLS on a table whose routes still use the plain `db` client
-- WOULD break those routes (current_setting is unset → zero rows). To avoid
-- breaking unconverted routes, we DELIBERATELY DO NOT enable RLS on Agent,
-- Policy, AgentClearance, TokenLog, AuthorizationRequest in this migration.
-- They remain app-code filtered until their routes are migrated. See the doc.
