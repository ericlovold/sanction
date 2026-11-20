import Link from "next/link"
import { logoutAction } from "@/app/login/actions"

export function AccountControl({ view }: { view: { name: string; isSession: boolean } }) {
  if (!view.isSession) {
    return (
      <div className="dash-account">
        <Link href="/login" className="g-btn g-btn-quiet g-btn-sm">Log in</Link>
      </div>
    )
  }
  return (
    <form action={logoutAction} className="dash-account">
      <button type="submit" className="g-btn g-btn-quiet g-btn-sm">Log out</button>
    </form>
  )
}
