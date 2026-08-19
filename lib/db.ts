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

// SEC-3: Postgres RLS is silently BYPASSED for superuser roles. If the app is
// ever mis-provisioned to connect as a superuser, tenant isolation is off — warn
// loudly (non-blocking, best-effort) so it's caught in logs.
if (process.env.NODE_ENV === "production") {
  db.$queryRaw<{ super: string }[]>`SELECT current_setting('is_superuser') AS super`
    .then((r) => {
      if (r?.[0]?.super === "on") {
        console.warn("[sanction] SECURITY WARNING: DB role is a SUPERUSER — Postgres RLS is BYPASSED. Connect as a non-superuser role.")
      }
    })
    .catch(() => {})
}
