// Return targets select an in-app page, never a new origin.
export function safeNext(raw: unknown): string {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//") || /[\\\x00-\x20]|%5c|%0[ad9]/i.test(raw)) return "/dashboard"
  return raw
}

export function approvalReturnPath(review: string): string {
  return `/dashboard/approvals?review=${encodeURIComponent(review)}`
}
