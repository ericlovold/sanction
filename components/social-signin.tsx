"use client"

import { useState } from "react"
import { authClient } from "@/lib/auth-client"

// Google + GitHub sign-in. Kicks off the OAuth redirect; on return the callback
// route sets the session cookie and lands on /dashboard, where the session
// bridge (lib/session.ts) provisions or claims the wallet.
function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.22V7.04H2.18a11 11 0 0 0 0 9.9l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.04l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  )
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden>
      <path d="M12 1C5.92 1 1 5.92 1 12c0 4.87 3.15 9 7.53 10.46.55.1.75-.24.75-.53l-.01-1.86c-3.06.67-3.71-1.48-3.71-1.48-.5-1.28-1.22-1.62-1.22-1.62-1-.68.08-.67.08-.67 1.1.08 1.68 1.14 1.68 1.14.98 1.68 2.57 1.2 3.2.92.1-.71.38-1.2.69-1.47-2.44-.28-5.01-1.22-5.01-5.44 0-1.2.43-2.18 1.13-2.95-.11-.28-.49-1.4.11-2.92 0 0 .92-.3 3.02 1.13a10.5 10.5 0 0 1 5.5 0c2.1-1.43 3.02-1.13 3.02-1.13.6 1.52.22 2.64.11 2.92.7.77 1.13 1.75 1.13 2.95 0 4.23-2.58 5.16-5.03 5.43.4.34.74 1 .74 2.02l-.01 2.99c0 .29.2.64.76.53A11 11 0 0 0 23 12c0-6.08-4.92-11-11-11z" />
    </svg>
  )
}

export function SocialSignIn({ callbackURL = "/dashboard" }: { callbackURL?: string }) {
  const [loading, setLoading] = useState<"google" | "github" | null>(null)

  async function go(provider: "google" | "github") {
    setLoading(provider)
    try {
      await authClient.signIn.social({ provider, callbackURL })
    } catch {
      setLoading(null)
    }
  }

  const base =
    "flex w-full items-center justify-center gap-2.5 rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-800 disabled:opacity-60"

  return (
    <div className="space-y-2.5">
      <button type="button" onClick={() => go("google")} disabled={loading !== null} className={base}>
        <GoogleMark />
        {loading === "google" ? "Redirecting…" : "Continue with Google"}
      </button>
      <button type="button" onClick={() => go("github")} disabled={loading !== null} className={base}>
        <GitHubMark />
        {loading === "github" ? "Redirecting…" : "Continue with GitHub"}
      </button>
    </div>
  )
}
