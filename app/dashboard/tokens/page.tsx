import { redirect } from "next/navigation"

// Folded into Seats (nav consolidation, 2026-07-16): an execution token is
// seat activity — the short-lived JWT a seat holds for one run. This stub
// keeps old bookmarks and docs links working. actions.ts stays — the
// execution-tokens section imports it from here.
export default function TokensPage() {
  redirect("/dashboard/agents#execution-tokens")
}
