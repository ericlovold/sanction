#!/usr/bin/env node
// Relative-link check for the markdown tree. macOS is case-insensitive, so a
// link like ./quickstart.md resolves locally and 404s on GitHub — this runs the
// check the way GitHub would (exact path, exact case). No dependencies.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs"
import { dirname, join, resolve, relative } from "node:path"

const ROOT = resolve(process.argv[2] ?? ".")
const SKIP = new Set(["node_modules", ".git", ".next", "coverage", "audit", "lib/generated"])

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const rel = relative(ROOT, p)
    if (SKIP.has(name) || SKIP.has(rel)) continue
    if (statSync(p).isDirectory()) yield* walk(p)
    else if (name.endsWith(".md")) yield p
  }
}

// Exact-case existence: walk the real directory listing segment by segment.
function existsExact(abs) {
  const parts = relative(ROOT, abs).split("/")
  let cur = ROOT
  for (const part of parts) {
    if (!existsSync(cur) || !readdirSync(cur).includes(part)) return false
    cur = join(cur, part)
  }
  return true
}

const LINK = /\]\((?!https?:|mailto:|#|\/)([^)\s#]+)(#[^)]*)?\)/g
let broken = 0
for (const file of walk(ROOT)) {
  const text = readFileSync(file, "utf8")
  for (const m of text.matchAll(LINK)) {
    const target = resolve(dirname(file), decodeURIComponent(m[1]))
    if (!existsExact(target)) {
      broken++
      console.log(`${relative(ROOT, file)}: broken link → ${m[1]}`)
    }
  }
}
if (broken) {
  console.error(`\n${broken} broken relative link(s).`)
  process.exit(1)
}
console.log("doc links ok")
