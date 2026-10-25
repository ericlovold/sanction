/** Pin pg's deprecated SSL aliases to certificate AND hostname verification. */
export function verifiedDatabaseUrl(connectionString: string): string {
  let url: URL
  try {
    url = new URL(connectionString)
  } catch {
    // Leave non-URL inputs to pg's parser; never expose credentials in errors.
    return connectionString
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return connectionString

  // pg uses the last value when a query parameter is repeated.
  const mode = url.searchParams.getAll("sslmode").at(-1)
  if (mode && ["prefer", "require", "verify-ca"].includes(mode)) {
    // Do not opt into libpq's weaker require/verify-ca semantics. verify-full
    // keeps both checks even if uselibpqcompat=true is already present.
    url.searchParams.set("sslmode", "verify-full")
    return url.toString()
  }
  return connectionString
}
