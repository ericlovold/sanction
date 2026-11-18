#!/usr/bin/env node
/**
 * Compile the eve agent (`.eve/`) for local `next start`.
 *
 * Why skip on Vercel: hosted builds set `VERCEL=1`, and a bare `eve build`
 * then writes Vercel Build Output under `.vercel/output` — which would
 * collide with the Next.js output from `next build`. `withEve` in
 * next.config.ts compiles the agent as part of that Next.js build instead.
 *
 * Off Vercel (local / CI): run `npx eve build` so `npm run build && npm start`
 * has the compiled agent `next start` expects.
 */
import { execSync } from "node:child_process"

const onVercel = process.env.VERCEL === "1"

if (onVercel) {
  console.log(
    `[eve-build] skipped — Vercel/withEve compiles the agent during next build ` +
      `(VERCEL=${process.env.VERCEL}).`,
  )
  process.exit(0)
}

console.log("[eve-build] compiling eve agent for local production start…")
execSync("npx eve build", { stdio: "inherit" })
