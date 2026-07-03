#!/usr/bin/env node
/**
 * Run `prisma migrate deploy` ONLY where it is safe to mutate the target
 * database — i.e. Vercel *production* builds, or an explicit local/CI opt-in.
 *
 * Why: the Vercel `build` script runs on every deployment, including branch
 * *preview* builds. Preview builds inherit the production DATABASE_URL, so an
 * unconditional `prisma migrate deploy` lets an in-flight feature branch apply
 * its migrations to the PRODUCTION database — which caused drift + a broken
 * prod deploy. Previews must never migrate prod.
 *
 * Rules:
 *   - On Vercel (`VERCEL=1`): migrate only when `VERCEL_ENV === "production"`.
 *   - Off Vercel (local/CI): migrate only when `RUN_MIGRATE_DEPLOY=1` (opt-in),
 *     so a bare `npm run build` never touches a database.
 */
import { execSync } from "node:child_process"

const onVercel = process.env.VERCEL === "1"
const vercelEnv = process.env.VERCEL_ENV // production | preview | development | undefined
const optIn = process.env.RUN_MIGRATE_DEPLOY === "1"

const shouldMigrate = onVercel ? vercelEnv === "production" : optIn

if (!shouldMigrate) {
  console.log(
    `[migrate-deploy] skipped — not a production migrate context ` +
      `(VERCEL=${process.env.VERCEL ?? "0"}, VERCEL_ENV=${vercelEnv ?? "none"}, RUN_MIGRATE_DEPLOY=${optIn ? "1" : "0"}).`,
  )
  process.exit(0)
}

// Prefer the direct (unpooled) connection for DDL, matching the previous script.
const databaseUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
if (!databaseUrl) {
  console.error("[migrate-deploy] DATABASE_URL is not set — cannot migrate.")
  process.exit(1)
}

const env = { ...process.env, DATABASE_URL: databaseUrl }

// ── One-shot drift recovery (REMOVE after the 2026-07 recovery deploy lands) ──
// The never-merged GTM branch applied its own monthlySpendBudgetUsd column to
// the production DB on 2026-06-17 (via the preview-migration leak this script
// now guards against). When 20260702180000_monthly_spend_budget shipped, its
// ADD COLUMN collided ("already exists", 42701) and Prisma marked the migration
// FAILED (P3018) — which blocks every subsequent production deploy.
//
// The existing prod column is Int?/nullable — byte-identical to what this
// migration creates — so resolving it as applied is the documented Prisma
// recovery (https://pris.ly/d/migrate-resolve) and is safe. Scoped to exactly
// this migration + exactly this error, so any other failure still fails loudly.
const RECOVERABLE_MIGRATION = "20260702180000_monthly_spend_budget"

function run(cmd) {
  // Capture output so we can pattern-match failures; echo it either way so the
  // Vercel build log stays as informative as stdio:"inherit" was.
  try {
    const out = execSync(cmd, { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    process.stdout.write(out)
    return { ok: true, out }
  } catch (e) {
    const out = `${e.stdout ?? ""}\n${e.stderr ?? ""}`
    process.stdout.write(out)
    return { ok: false, out }
  }
}

console.log("[migrate-deploy] applying prisma migrate deploy to the production target…")
const first = run("npx prisma migrate deploy")
if (!first.ok) {
  // The same failed-migration record surfaces under two codes: P3018 with
  // "already exists" on the run that records the failure, and P3009 ("migrate
  // found failed migrations") on every run after it. Both name the migration.
  const namesIt = first.out.includes(RECOVERABLE_MIGRATION)
  const isKnownDrift =
    (namesIt && first.out.includes("P3018") && first.out.includes("already exists")) ||
    (namesIt && first.out.includes("P3009"))
  if (!isKnownDrift) {
    console.error("[migrate-deploy] migrate deploy failed (not the known drift) — failing the build.")
    process.exit(1)
  }
  console.log(
    `[migrate-deploy] known drift detected: ${RECOVERABLE_MIGRATION} collided with the pre-existing ` +
      `column from the 2026-06-17 preview-migration leak. Resolving as applied and retrying…`,
  )
  const resolve = run(`npx prisma migrate resolve --applied ${RECOVERABLE_MIGRATION}`)
  if (!resolve.ok) {
    console.error("[migrate-deploy] migrate resolve failed — failing the build.")
    process.exit(1)
  }
  const retry = run("npx prisma migrate deploy")
  if (!retry.ok) {
    console.error("[migrate-deploy] migrate deploy still failing after resolve — failing the build.")
    process.exit(1)
  }
  console.log("[migrate-deploy] drift recovered; migrations are current.")
}
