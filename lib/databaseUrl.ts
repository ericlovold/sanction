/** Pin pg's deprecated SSL aliases to certificate AND hostname verification. */
export function verifiedDatabaseUrl(connectionString: string): string {
  // Normalize only the query so pg retains responsibility for supported URL
  // forms (including credentials with an empty host and a host query option).
  if (!/^(postgres|postgresql|pg):\/\//i.test(connectionString)) return connectionString
  const queryStart = connectionString.indexOf("?")
  const fragmentStart = connectionString.indexOf("#")
  if (queryStart < 0 || (fragmentStart >= 0 && fragmentStart < queryStart)) return connectionString
  const queryEnd = fragmentStart < 0 ? connectionString.length : fragmentStart
  const params = new URLSearchParams(connectionString.slice(queryStart + 1, queryEnd))

  // pg uses the last value when a query parameter is repeated.
  const mode = params.getAll("sslmode").at(-1)
  if (mode && ["prefer", "require", "verify-ca"].includes(mode)) {
    // Do not opt into libpq's weaker require/verify-ca semantics. verify-full
    // keeps both checks even if uselibpqcompat=true is already present.
    params.set("sslmode", "verify-full")
    return connectionString.slice(0, queryStart + 1) + params.toString() + connectionString.slice(queryEnd)
  }
  return connectionString
}
