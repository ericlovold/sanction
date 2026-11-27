import { agentBlockAccount } from "@/lib/agentConnectFacts"
import { getSessionMember } from "@/lib/session"

// The public connection guide is prerendered, so its account-specific agent
// blocks are filled in from here after load. A real session only: the public
// demo wallet (getViewWallet's fallback) is never read.
export const dynamic = "force-dynamic"
const headers = { "Cache-Control": "private, no-store" }

export async function GET() {
  try {
    const member = await getSessionMember()
    if (!member) return Response.json({ account: null }, { headers })
    return Response.json({ account: await agentBlockAccount(member.wallet, member.role) }, { headers })
  } catch {
    // The guide falls back to its generic blocks.
    return Response.json({ account: null }, { headers })
  }
}
