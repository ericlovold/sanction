/** Preserve repeated resource parameters and the provider's signed query. */
export function mcpOAuthQuery(params: Record<string, string | string[] | undefined>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item)
  }
  const result = query.toString()
  if (result.length > 16_384) throw new Error("Connection request is too large")
  return result
}
