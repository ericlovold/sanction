import { toNextJsHandler } from "better-auth/next-js"
import { auth } from "@/lib/auth-config"

// Better Auth's OAuth + session endpoints (sign-in, callbacks, sign-out, session).
// Lives at /api/auth/* — the agent/management API stays under /api/v1/*.
export const { GET, POST } = toNextJsHandler(auth)
