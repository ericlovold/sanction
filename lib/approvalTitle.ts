import { fmtUsd } from "@/lib/format"

// How a pending approval is named for a person: "$480.00 Datadog",
// "2 × GPU hours — $90.00 (aws)", or the tool that was asked for. Shared by the
// approval inbox and the dashboard home so both show the same words.

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null
}

export function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

export function actionLabel(actionType: string) {
  return actionType
    .split(".")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

export function resourceTitle(resource: Record<string, unknown>, actionType: string) {
  if (resource.kind === "spend") {
    const amount = numberValue(resource.amount_usd)
    const merchant = stringValue(resource.merchant) ?? "Unknown merchant"
    return amount === null ? merchant : `${fmtUsd(amount)} ${merchant}`
  }
  if (resource.kind === "provision") {
    const quantity = numberValue(resource.quantity)
    const lineItem = stringValue(resource.line_item) ?? "Unknown item"
    const amount = numberValue(resource.amount_usd)
    const res = stringValue(resource.resource)
    const head = quantity === null ? lineItem : `${quantity} × ${lineItem}`
    return `${head}${amount === null ? "" : ` — ${fmtUsd(amount)}`}${res ? ` (${res})` : ""}`
  }
  return (
    stringValue(resource.label) ??
    stringValue(resource.tool) ??
    stringValue(resource.tool_name) ??
    stringValue(resource.credential_label) ??
    stringValue(resource.name) ??
    actionLabel(actionType)
  )
}
