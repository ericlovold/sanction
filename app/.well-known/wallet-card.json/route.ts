import { NextRequest, NextResponse } from "next/server"
import { publicOrigin } from "@/lib/authzen"
import { walletCard } from "@/lib/walletCard"

// Platform Wallet Card. Public by design — names how an agent carries, presents,
// and verifies a Sanction wallet. Analogous to GET /.well-known/authzen-configuration
// and to an A2A Agent Card, for the wallet layer those protocols do not define.

export async function GET(req: NextRequest) {
  const origin = publicOrigin(req)
  return NextResponse.json(walletCard(origin), {
    headers: { "cache-control": "public, max-age=3600" },
  })
}
