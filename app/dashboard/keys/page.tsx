import { redirect } from "next/navigation"

// Folded into Team & access (nav consolidation, 2026-07-16): the management
// key lives with the humans who hold it; agent keys live on Seats. This stub
// keeps old bookmarks and docs links working. actions.ts stays — the
// management-key card imports it from here.
export default function ApiKeysPage() {
  redirect("/dashboard/team")
}
