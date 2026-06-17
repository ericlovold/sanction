import Link from "next/link"
import { logoutAction } from "@/app/login/actions"

export function AccountControl({ view }: { view: { name: string; isSession: boolean } }) {
  if (!view.isSession) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-zinc-500">demo</span>
        <Link href="/login" className="text-zinc-400 hover:text-zinc-100">Log in</Link>
      </div>
    )
  }
  return (
    <form action={logoutAction} className="flex items-center gap-2 text-xs">
      <span className="hidden text-zinc-500 sm:inline">{view.name}</span>
      <button type="submit" className="rounded border border-zinc-700 px-2 py-1 text-zinc-400 transition-colors hover:text-zinc-100">
        Log out
      </button>
    </form>
  )
}
