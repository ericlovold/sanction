import type { Metadata } from "next"
import Link from "next/link"
import { headers } from "next/headers"
import { db } from "@/lib/db"
import { hashApiKey } from "@/lib/apiKey"
import { auth } from "@/lib/auth-config"
import { SocialSignIn } from "@/components/social-signin"
import { AcceptInviteForm } from "@/components/accept-invite-form"
import { logoutAction } from "@/app/login/actions"
import "../../brand.css"
import { brandFontVars } from "../../brand-fonts"

export const metadata: Metadata = { title: "Sanction — Accept invite" }
export const dynamic = "force-dynamic"

const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", viewer: "Viewer" }

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className={`sanction ${brandFontVars}`} style={{ minHeight: "100vh", background: "var(--surface-page)", color: "var(--text-body)" }}>
      <header className="border-b" style={{ borderColor: "var(--paper-3)" }}>
        <nav className="mx-auto flex h-14 max-w-3xl items-center px-6">
          <Link href="/" className="font-semibold tracking-tight">Sanction</Link>
        </nav>
      </header>
      <main className="mx-auto max-w-md px-6 py-14">{children}</main>
    </div>
  )
}

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  const invite = await db.walletMember.findUnique({ where: { tokenHash: hashApiKey(token) } })

  if (!invite || (invite.status === "pending" && (!invite.tokenExpiresAt || invite.tokenExpiresAt < new Date()))) {
    return (
      <Shell>
        <h1 className="text-2xl font-semibold tracking-tight">Invite not found</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
          This invite link is invalid or has expired. Ask whoever invited you to send a new one.
        </p>
      </Shell>
    )
  }

  const wallet = await db.wallet.findUnique({ where: { id: invite.walletId } })
  const walletName = wallet?.name ?? "this workspace"
  const roleLabel = ROLE_LABEL[invite.role] ?? invite.role

  if (invite.status === "revoked") {
    return (
      <Shell>
        <h1 className="text-2xl font-semibold tracking-tight">Invite revoked</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
          This invite to {walletName} is no longer active.
        </p>
      </Shell>
    )
  }

  if (invite.status === "active") {
    return (
      <Shell>
        <h1 className="text-2xl font-semibold tracking-tight">Already accepted</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
          You&rsquo;re already a member of {walletName}.
        </p>
        <Link href="/dashboard" className="sanction-link mt-6 inline-block text-sm">Go to dashboard →</Link>
      </Shell>
    )
  }

  const session = await auth.api.getSession({ headers: await headers() })

  if (!session?.user) {
    return (
      <Shell>
        <h1 className="text-2xl font-semibold tracking-tight">Join {walletName}</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
          You&rsquo;ve been invited as <strong>{roleLabel}</strong>. Sign in with the Google or GitHub account for{" "}
          <strong>{invite.email}</strong> to accept.
        </p>
        <div className="mt-8">
          <SocialSignIn callbackURL={`/invite/${token}`} />
        </div>
      </Shell>
    )
  }

  if (session.user.email.toLowerCase() !== invite.email.toLowerCase()) {
    return (
      <Shell>
        <h1 className="text-2xl font-semibold tracking-tight">Wrong account</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
          This invite was sent to <strong>{invite.email}</strong>, but you&rsquo;re signed in as {session.user.email}.
          Sign out, then reopen the invite link from your email with the right account.
        </p>
        <form action={logoutAction} className="mt-6">
          <button type="submit" className="sanction-link text-sm">Sign out →</button>
        </form>
      </Shell>
    )
  }

  return (
    <Shell>
      <h1 className="text-2xl font-semibold tracking-tight">Join {walletName}</h1>
      <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
        You&rsquo;ve been invited as <strong>{roleLabel}</strong>, signed in as {session.user.email}.
      </p>
      <AcceptInviteForm token={token} />
    </Shell>
  )
}
