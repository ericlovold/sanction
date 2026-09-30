import { notFound } from "next/navigation"
import { SocialSignIn } from "@/components/social-signin"
import { mcpOAuthEnabled } from "@/lib/mcpOAuthProvider"
import { mcpOAuthQuery } from "@/lib/mcpOAuthQuery"

export const dynamic = "force-dynamic"
export default async function McpLogin({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!mcpOAuthEnabled()) notFound()
  const query = mcpOAuthQuery(await searchParams)
  const callbackURL = query ? `/api/auth/oauth2/authorize?${query}` : "/connect/mcp"
  return <main className="mx-auto max-w-md px-6 py-14 text-zinc-200">
    <h1 className="text-3xl font-semibold">Sign in to connect Sanction</h1>
    <p className="my-6 text-zinc-400">Use the verified account that owns or administers your wallet. Next, choose which agent this host can use.</p>
    <SocialSignIn callbackURL={callbackURL} apple={!!process.env.APPLE_CLIENT_ID} />
  </main>
}
