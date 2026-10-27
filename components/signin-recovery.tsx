"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"

export function SignInRecovery({ onLoginPage = false }: { onLoginPage?: boolean }) {
  const params = useSearchParams()
  const error = params.get("error")
  if (!error) return null

  const stateError = ["state_mismatch", "state_not_found", "state_expired", "invalid_state"].includes(error)
  return <section role="alert" className="my-6 rounded-md border p-4 text-sm" style={{ borderColor: "var(--paper-3)", background: "var(--surface-card)", color: "var(--text-body)" }}>
    <h2 className="font-semibold" style={{ fontSize: "1rem", lineHeight: 1.5 }}>Sign-in didn’t finish</h2>
    <p className="mt-2">{stateError
      ? "We couldn’t verify this sign-in attempt. Start again and complete sign-in in the same browser."
      : "Your sign-in attempt wasn’t completed. Try again or choose another sign-in method."}</p>
    {onLoginPage
      ? <p className="mt-2">Choose a sign-in method below to start a fresh attempt.</p>
      : <Link className="sanction-link mt-3 inline-block font-medium" href="/login">Try signing in again →</Link>}
  </section>
}
