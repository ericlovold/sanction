import { createAuthClient } from "better-auth/react"

// Browser-side Better Auth client. baseURL is inferred from the current origin
// in the browser; NEXT_PUBLIC_BETTER_AUTH_URL pins it for SSR/preview if set.
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_BETTER_AUTH_URL,
})

export const { signIn, signOut, useSession } = authClient
