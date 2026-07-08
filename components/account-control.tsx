import Link from "next/link"
import { logoutAction } from "@/app/login/actions"

export function AccountControl({ view }: { view: { name: string; isSession: boolean } }) {
  if (!view.isSession) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="rounded border border-input px-1.5 py-0.5 text-foreground0">demo</span>
        <Link href="/login" className="text-muted-foreground hover:text-foreground">Log in</Link>
      </div>
    )
  }
  return (
    <form action={logoutAction} className="flex items-center gap-2 text-xs">
      <span className="hidden text-foreground0 sm:inline">{view.name}</span>
      <button type="submit" className="rounded border border-input px-2 py-1 text-muted-foreground transition-colors hover:text-foreground">
        Log out
      </button>
    </form>
  )
}
