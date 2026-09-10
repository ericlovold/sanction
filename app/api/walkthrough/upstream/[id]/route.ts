import { NextRequest, NextResponse } from "next/server"
import { receiveWalkthroughCall } from "@/lib/brokerWalkthrough"
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const result = await receiveWalkthroughCall(id, req.headers.get("authorization"), await req.json().catch(() => null))
  return NextResponse.json(result ?? { error: "Unauthorized" }, { status: result ? 200 : 401, headers: { "Cache-Control": "no-store" } })
}
