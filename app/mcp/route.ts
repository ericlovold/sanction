import { NextRequest } from "next/server"
import { handleSanctionMcpRequest } from "@/lib/mcpRemote"

export const dynamic = "force-dynamic"
export const maxDuration = 30

export async function POST(req: NextRequest) {
  return handleSanctionMcpRequest(req)
}

export async function GET(req: NextRequest) {
  return handleSanctionMcpRequest(req)
}

export async function DELETE(req: NextRequest) {
  return handleSanctionMcpRequest(req)
}
