import { redirect } from "next/navigation"

// Folded into Pools (nav consolidation, 2026-07-16): observe/enforce is a
// property of a pool, not a place of its own. This stub keeps old bookmarks
// and docs links working. actions.ts stays — the enforcement toggle imports
// it from here.
export default function ObservePage() {
  redirect("/dashboard/pools#enforcement")
}
