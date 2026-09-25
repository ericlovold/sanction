import { Client } from "pg"

// SEC-3: DB tests run the app the way production must — as a restricted role
// (NOSUPERUSER NOBYPASSRLS, DML grants only), so FORCE RLS is actually enforced
// and any tenant-table access outside withTenant() fails here instead of
// passing silently under a superuser. Gated on RUN_DB_TESTS=1; a no-op for the
// unit suite.
//
// DATABASE_URL arrives as the OWNER connection (migrations already applied). We
// provision `sanction_app` with grants mirroring docs/SECURITY.md, then hand the
// workers DATABASE_URL = sanction_app and DATABASE_ADMIN_URL = owner (for tests
// that seed or inspect across tenants on purpose).
export const APP_ROLE = "sanction_app"

export function appRoleUrl(ownerUrl: string): string {
  const u = new URL(ownerUrl)
  u.username = APP_ROLE
  u.password = "app"
  return u.toString()
}

export default async function setup() {
  if (process.env.RUN_DB_TESTS !== "1" || !process.env.DATABASE_URL) return
  const ownerUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL
  const owner = new Client({ connectionString: ownerUrl })
  await owner.connect()
  try {
    // Roles are cluster-global (another test DB may have created it); grants are per-DB.
    await owner.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
        CREATE ROLE ${APP_ROLE} LOGIN PASSWORD 'app' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
      END IF;
      EXECUTE format('GRANT CONNECT ON DATABASE %I TO ${APP_ROLE}', current_database());
    END $$;`)
    await owner.query(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`)
    await owner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`)
    await owner.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE}`)
    await owner.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE}`)
    await owner.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${APP_ROLE}`)
    const { rows } = await owner.query(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = '${APP_ROLE}'`,
    )
    if (rows[0]?.rolsuper || rows[0]?.rolbypassrls) {
      throw new Error(`${APP_ROLE} exists with SUPERUSER/BYPASSRLS — RLS proofs would be void. Drop or ALTER the role.`)
    }
  } finally {
    await owner.end()
  }
  process.env.DATABASE_ADMIN_URL = ownerUrl
  process.env.DATABASE_URL = appRoleUrl(ownerUrl)
}
