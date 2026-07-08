import { NextResponse, type NextRequest } from "next/server"
import { ACQ_COOKIE, ACQ_COOKIE_MAX_AGE, acquisitionFromRequest } from "@/lib/acquisition"

// First-touch acquisition capture (lib/acquisition.ts): when a visitor arrives
// with utm params, ?src=, or an external referrer and has no acquisition cookie
// yet, record the channel + landing path. Signup reads the cookie and stamps it
// onto the Wallet so the funnel can tie channel → signup → first governed
// decision. First-touch-wins: an existing cookie is never overwritten.
export function proxy(req: NextRequest) {
  if (req.cookies.has(ACQ_COOKIE)) return NextResponse.next()

  const acq = acquisitionFromRequest(req.nextUrl, req.headers.get("referer"))
  if (!acq) return NextResponse.next()

  const res = NextResponse.next()
  res.cookies.set(ACQ_COOKIE, JSON.stringify(acq), {
    maxAge: ACQ_COOKIE_MAX_AGE,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  })
  return res
}

export const config = {
  // Page routes only — not the API planes, Next internals, or static assets.
  matcher: ["/((?!api|_next|brand|.*\\..*).*)"],
}
