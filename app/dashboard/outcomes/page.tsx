import { redirect } from "next/navigation"

// Folded into Spend (nav consolidation, 2026-07-16): cost-per-outcome is a
// spend lens — what the spend was FOR. This stub keeps old bookmarks and
// docs links working.
export default function OutcomesPage() {
  redirect("/dashboard/spend#outcomes")
}
