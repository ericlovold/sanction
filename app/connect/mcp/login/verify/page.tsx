import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { mcpOAuthEnabled } from "@/lib/mcpOAuthProvider"
import { ConfirmIdentityEmailForm } from "../email-form"

export const dynamic = "force-dynamic"
export const metadata: Metadata = {
  title: "Confirm sign-in — Sanction",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
}

// GET only renders a confirmation. Email scanners must never consume a link.
export default async function VerifyIdentityEmail({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  if (!mcpOAuthEnabled()) notFound()
  const { token } = await searchParams
  return <main className="dark mx-auto w-full max-w-md space-y-7 px-6 py-14">
    <h1 className="text-3xl font-semibold">Confirm your sign-in</h1>
    {typeof token === "string" && token.length > 0 && token.length <= 32768
      ? <ConfirmIdentityEmailForm token={token} />
      : <p role="alert" className="text-sm text-muted-foreground">This sign-in link is incomplete. Request a new link.</p>}
    <Link href="/connect/mcp/login" className="block text-sm text-muted-foreground underline underline-offset-4">Return to sign-in</Link>
  </main>
}
