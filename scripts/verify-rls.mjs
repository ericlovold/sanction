// SEC-3 Row-Level Security verifier.
//
// Run AFTER `npx prisma migrate deploy` against a NON-PRODUCTION database, on a
// checkout of the security branch (claude/sanction-security-gate-sec1-sec3):
//
//   export DATABASE_URL='postgresql://...neon.tech/neondb?sslmode=require'   # direct host (no -pooler)
//   node scripts/verify-rls.mjs
//
// Proves: the app role can't bypass RLS; a tenant sees only its own rows; no
// tenant context returns zero rows (fail-closed); and cross-tenant writes are
// rejected by WITH CHECK. Seeds + cleans up its own `rlschk_*` rows.
import pg from "pg"

const { Client } = pg
const url = process.env.DATABASE_URL
if (!url) {
  console.error("DATABASE_URL is not set."); process.exit(2)
}

const A = "rlschk_wallet_A"
const B = "rlschk_wallet_B"
let fails = 0
const check = (name, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) fails++ }

const c = new Client({ connectionString: url })
const setTenant = (w) => c.query("select set_config('app.current_wallet', $1, false)", [w])
const seenIds = async () =>
  (await c.query(`select id, "walletId" from "CredentialVault" where id like 'rlschk_%' order by id`)).rows

async function cleanup() {
  for (const w of [A, B]) { await setTenant(w); await c.query(`delete from "CredentialVault" where id like 'rlschk_%'`) }
  await setTenant("")
  await c.query(`delete from "Wallet" where id in ($1,$2)`, [A, B])
}

try {
  await c.connect()

  // 1. The role must not be able to bypass RLS, or the policies are cosmetic.
  const role = (await c.query(
    "select current_user as u, (select rolsuper from pg_roles where rolname=current_user) as super, (select rolbypassrls from pg_roles where rolname=current_user) as bypassrls",
  )).rows[0]
  console.log(`role: ${role.u}  rolsuper=${role.super}  rolbypassrls=${role.bypassrls}\n`)
  check("role is NOT a superuser", role.super === false)
  check("role does NOT have BYPASSRLS", role.bypassrls === false)

  await cleanup() // idempotent: clear any leftovers from a prior run

  // Seed two wallets (Wallet has no RLS) and one credential each (RLS forces a
  // matching tenant context to insert).
  await c.query(`insert into "Wallet"(id,name,"ownerEmail") values($1,$2,$3)`, [A, "rls A", "rlsA@test.local"])
  await c.query(`insert into "Wallet"(id,name,"ownerEmail") values($1,$2,$3)`, [B, "rls B", "rlsB@test.local"])
  await setTenant(A)
  await c.query(`insert into "CredentialVault"(id,"walletId",label,type,"encryptedValue","updatedAt") values($1,$2,$3,$4,$5,now())`, ["rlschk_credA", A, "k", "api_key", "ENC_A"])
  await setTenant(B)
  await c.query(`insert into "CredentialVault"(id,"walletId",label,type,"encryptedValue","updatedAt") values($1,$2,$3,$4,$5,now())`, ["rlschk_credB", B, "k", "api_key", "ENC_B"])

  // 2. Tenant A sees only A; tenant B sees only B.
  await setTenant(A)
  let rows = await seenIds()
  check("tenant A sees ONLY its own credential", rows.length === 1 && rows[0].walletId === A)
  await setTenant(B)
  rows = await seenIds()
  check("tenant B sees ONLY its own credential", rows.length === 1 && rows[0].walletId === B)

  // 3. No tenant context -> zero rows (fail-closed).
  await setTenant("")
  rows = await seenIds()
  check("no tenant context => ZERO rows (fail-closed)", rows.length === 0)

  // 4. Cross-tenant write is rejected by WITH CHECK.
  await setTenant(A)
  let blocked = false
  try {
    await c.query(`insert into "CredentialVault"(id,"walletId",label,type,"encryptedValue","updatedAt") values($1,$2,$3,$4,$5,now())`, ["rlschk_cross", B, "x", "api_key", "X"])
  } catch (e) {
    blocked = /row-level security/i.test(e.message)
  }
  check("cross-tenant write blocked by WITH CHECK", blocked)

  await cleanup()
  console.log(fails ? `\n${fails} CHECK(S) FAILED — RLS is NOT protecting tenants correctly.` : `\nALL RLS CHECKS PASSED ✓`)
} catch (e) {
  console.error("\nVERIFIER ERROR:", e.message)
  fails ||= 1
} finally {
  try { await c.end() } catch {}
}
process.exit(fails ? 1 : 0)
