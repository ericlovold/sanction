import Link from "next/link"
import { getSessionMember } from "@/lib/session"
import { hasRole } from "@/lib/roles"
import { cursorDay } from "@/lib/connectors/cursorSources"
import { incidentDetail } from "./incident-detail"
import { billingOverview } from "../billing-overview"

export const dynamic = "force-dynamic"
export const metadata = { title: "Cursor billing export | Sanction" }

export default async function CursorUsagePage({ searchParams }: { searchParams?: Promise<{ day?: string | string[] }> }) {
  const day = (await searchParams)?.day
  const start = day === undefined ? null : cursorDay(day)
  const member = await getSessionMember()
  if (!member) {
    const next = start ? `/dashboard/usage/cursor?day=${start.toISOString().slice(0, 10)}#incident` : "/dashboard/usage/cursor"
    return <Link href={`/login?next=${encodeURIComponent(next)}`}>Sign in to view Cursor billing items</Link>
  }
  const { wallet } = member
  if (day !== undefined) {
    if (!start) return <div className="p-5"><h1 className="text-2xl font-semibold">Invalid Cursor usage date</h1><Link href="/dashboard/usage/cursor" className="underline">View imported days</Link></div>
    return incidentDetail(wallet.id, wallet.name, start, hasRole(member.role, "admin"))
  }
  return billingOverview(wallet, hasRole(member.role, "admin"), "cursor")
}
