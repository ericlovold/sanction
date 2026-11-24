import Link from "next/link"
import { getSessionMember } from "@/lib/session"
import { hasRole } from "@/lib/roles"
import { billingOverview } from "../billing-overview"

export const dynamic = "force-dynamic"
export const metadata = { title: "Grok Bot billing export | Sanction" }

export default async function GrokBotUsagePage() {
  const member = await getSessionMember()
  if (!member) {
    return <Link href="/login?next=%2Fdashboard%2Fusage%2Fgrok-bot">Sign in to view Grok Bot billing items</Link>
  }
  return billingOverview(member.wallet, hasRole(member.role, "admin"), "grok-bot")
}
