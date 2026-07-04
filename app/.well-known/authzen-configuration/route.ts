import { NextRequest, NextResponse } from "next/server"
import { ACCESS_REQUEST_PATH, AUTHZEN_CAPABILITY_ACCESS_REQUEST, publicOrigin } from "@/lib/authzen"

// AuthZEN PDP discovery metadata. Public by design (it names endpoints, not
// secrets) — a PEP given only the host can find the evaluation and
// access-request endpoints and see that the approval profile is supported.
// SANCTION_PUBLIC_ORIGIN pins the advertised origin behind untrusted proxies.

export async function GET(req: NextRequest) {
  const origin = publicOrigin(req)
  return NextResponse.json(
    {
      policy_decision_point: `${origin}/api`,
      access_evaluation_endpoint: `${origin}/api/access/v1/evaluation`,
      access_evaluations_endpoint: `${origin}/api/access/v1/evaluations`,
      access_request_endpoint: `${origin}${ACCESS_REQUEST_PATH}`,
      capabilities: [AUTHZEN_CAPABILITY_ACCESS_REQUEST],
    },
    { headers: { "cache-control": "public, max-age=3600" } },
  )
}
