import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "./generated/prisma/client"

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

function createClient() {
  // A fresh clone's first failure used to be a raw Prisma P1001 five layers
  // down. Name the actual problem — and the fix — at the source instead.
  // Dev-only: production builds/deploys construct lazily and manage env
  // elsewhere; the newcomer hitting this is always on `next dev`.
  if (!process.env.DATABASE_URL && process.env.NODE_ENV === "development") {
    throw new Error(
      "DATABASE_URL is not set. Sanction's API routes need Postgres: copy .env.example to .env.local, " +
        "point DATABASE_URL at a running Postgres, and run `npx prisma migrate deploy`. " +
        "Unit tests don't need this (`npm run check`); the dev server's API routes do.",
    )
  }
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
  return new PrismaClient({ adapter })
}

export const db = globalForPrisma.prisma ?? createClient()

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db

// SEC-3: Postgres RLS is silently BYPASSED for roles with SUPERUSER or
// BYPASSRLS (Neon's default owner inherits BYPASSRLS via neon_superuser). If
// the app is mis-provisioned onto such a role, tenant isolation is off — say so
// loudly (non-blocking, best-effort) so it's caught in logs.
type RoleRow = { rolsuper: boolean; rolbypassrls: boolean }

export async function checkRlsRole(client: Pick<PrismaClient, "$queryRaw">): Promise<string[]> {
  const r = await client.$queryRaw<RoleRow[]>`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`
  const bypass = [r?.[0]?.rolsuper && "SUPERUSER", r?.[0]?.rolbypassrls && "BYPASSRLS"].filter(Boolean) as string[]
  if (bypass.length) {
    console.error(
      `[sanction] SECURITY: DB role has ${bypass.join(" + ")} — Postgres RLS is BYPASSED. ` +
        "Point DATABASE_URL at the restricted sanction_app role (see docs/SECURITY.md).",
    )
  }
  return bypass
}

if (process.env.NODE_ENV === "production") {
  checkRlsRole(db).catch(() => {})
}
