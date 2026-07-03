import { redirect } from "next/navigation"

// Grants folded into the Authorization inbox (PWA phase 3): a grant is the
// receipt of an approval — one story, one page. Deep links keep working.
export default function GrantsRedirect() {
  redirect("/dashboard/approvals")
}
