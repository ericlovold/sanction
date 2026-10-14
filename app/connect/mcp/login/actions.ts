"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { z } from "zod"
import { auth } from "@/lib/auth-config"
import { db } from "@/lib/db"
import { rateLimit, ipFromHeaders } from "@/lib/rateLimit"
import { identityEmailCallback, identityEmailRateKey, readIdentityEmailEnvelope } from "@/lib/identityEmailLogin"

export type IdentityEmailLoginState = { sent: boolean; error: string }
export type IdentityEmailConfirmState = { error: string }

export async function requestIdentityEmailLogin(_previous: IdentityEmailLoginState, form: FormData): Promise<IdentityEmailLoginState> {
  const h = await headers()
  if (!(await rateLimit("identity_email_request_ip", ipFromHeaders(h), 5, 600)).ok) return { sent: false, error: "Too many requests. Try again later." }
  const parsed = z.string().trim().toLowerCase().email().max(200).safeParse(form.get("email"))
  if (!parsed.success) return { sent: false, error: "Enter a valid email address." }
  let callback: string
  try { callback = identityEmailCallback(form.get("callback_url") ?? "/dashboard") }
  catch { return { sent: false, error: "Restart sign-in from your host." } }
  // Email throttling has the same response as an unknown account.
  const sent = { sent: true, error: "" }
  if (!(await rateLimit("identity_email_request_email", identityEmailRateKey(parsed.data), 5, 600)).ok) return sent
  const user = await db.user.findUnique({ where: { email: parsed.data }, select: { id: true } })
  if (!user) return sent
  try {
    await auth.api.signInMagicLink({ headers: h, body: { email: parsed.data, callbackURL: callback } })
  } catch {
    // Do not leak account existence or log an exception that could contain a link.
    console.error("Identity sign-in email could not be delivered")
  }
  return sent
}

export async function confirmIdentityEmailLogin(_previous: IdentityEmailConfirmState, form: FormData): Promise<IdentityEmailConfirmState> {
  const h = await headers()
  if (!(await rateLimit("identity_email_verify_ip", ipFromHeaders(h), 20, 600)).ok) return { error: "Too many attempts. Try again later." }
  let callback: string
  try {
    const envelope = await readIdentityEmailEnvelope(String(form.get("token") ?? ""))
    if (!(await rateLimit("identity_email_verify_email", identityEmailRateKey(envelope.email), 10, 600)).ok) return { error: "Too many attempts. Try again later." }
    // No callback input reaches the plugin. Its atomic single-use verification
    // creates the cookie; only the signed envelope selects the return page.
    await auth.api.magicLinkVerify({ headers: h, query: { token: envelope.token } })
    callback = envelope.callback
  } catch {
    return { error: "This sign-in link is invalid or expired. Request a new one." }
  }
  redirect(callback)
}
