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
      <button type="submit" className="shrink-0 cursor-pointer whitespace-nowrap rounded border-2 border-white/80 px-2.5 py-1.5 font-medium text-white transition-colors hover:border-white hover:bg-white hover:text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:bg-white/85">
        Log out
      </button>
    </form>
  )
}
