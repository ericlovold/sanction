import { notFound } from "next/navigation"
import { McpTesterClient } from "./mcp-tester-client"

export const metadata = { title: "Sanction MCP Tester" }

export default function McpTesterPage() {
  const enabled = process.env.NODE_ENV !== "production" || process.env.MCP_TESTER_ENABLED === "1"
  if (!enabled) notFound()
  return <McpTesterClient />
}
