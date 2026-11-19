import { notFound } from "next/navigation"
import { SocialSignIn } from "@/components/social-signin"
import { mcpOAuthEnabled } from "@/lib/mcpOAuthProvider"
import { mcpOAuthQuery } from "@/lib/mcpOAuthQuery"
import { IdentityEmailForm } from "./email-form"

export const dynamic = "force-dynamic"
export default async function McpLogin({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!mcpOAuthEnabled()) notFound()
  const query = mcpOAuthQuery(await searchParams)
  const callbackURL = query ? `/api/auth/oauth2/authorize?${query}` : "/connect/mcp"
  return <>
    <h1>Sign in to connect Sanction</h1>
    <p className="sn-connect-secondary">Sign in with the account that owns or administers your wallet. Next, choose which agent this tool can use.</p>
    <div className="w-full max-w-md">
      <SocialSignIn callbackURL={callbackURL} apple={!!process.env.APPLE_CLIENT_ID} />
      <div className="my-7 flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />or use email<span className="h-px flex-1 bg-border" /></div>
      <IdentityEmailForm callbackURL={callbackURL} />
    </div>
  </>
}
