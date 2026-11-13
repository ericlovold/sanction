/**
 * Agent key for the eve → hosted MCP connection.
 * Fail closed at request time (not import/build time) so `eve build` and CI
 * can compile the agent without a live key. Never log the value.
 */
export function requireSanctionApiKey(key: string | undefined = process.env.SANCTION_API_KEY): string {
  const trimmed = key?.trim() ?? ""
  if (!trimmed) {
    throw new Error(
      "Sanction MCP — SANCTION_API_KEY is not set. " +
        "The eve connection to hosted MCP requires an agent key (pxy_...). " +
        "Set SANCTION_API_KEY in the environment (see .env.example). " +
        "Create a wallet at https://getsanction.com/start",
    )
  }
  if (/[\r\n]/.test(trimmed)) {
    throw new Error("Sanction MCP — SANCTION_API_KEY must be a single-line agent key.")
  }
  if (!trimmed.startsWith("pxy_")) {
    throw new Error(
      "Sanction MCP — SANCTION_API_KEY must be an agent key starting with pxy_. " +
        "Management keys are refused. Do not paste a key into chat or source.",
    )
  }
  return trimmed
}
