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

console.log("[migrate-deploy] applying prisma migrate deploy to the production target…")
execSync("npx prisma migrate deploy", {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: databaseUrl },
})
