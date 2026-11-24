import { parse } from "csv-parse/browser/esm/sync"
import { cursorItem, type CursorItem, type BillingProduct } from "./cursorBilling"

const columns = ["Billing Item ID", "Event Time", "Product", "Charge Category", "Usage Type",
  "Usage", "Pricing Currency", "Pricing Contracted", "Model"]
const units = ["prompt-text-tokens", "completion-text-tokens", "cached-prompt-text-tokens", "cache-write-text-tokens"]

export function readBillingCsv(text: string, product: BillingProduct): { rows: CursorItem[]; skipped: number } {
  const records: Record<string, string>[] = parse(text, {
    bom: true, skip_empty_lines: true, max_record_size: 32768,
    columns(header: string[]) {
      if (!columns.every(key => header.includes(key)) || new Set(header).size !== header.length) {
        throw Error("Expected unified usage export columns.")
      }
      return header
    },
  })
  if (!records.length) throw Error("The export contains no billing items.")
  let skipped = 0
  const rows: CursorItem[] = []
  for (const [index, row] of records.entries()) {
    if (row.Product !== product) { skipped++; continue }
    try {
      const usage = JSON.parse(row.Usage || "{}")
      if (!usage || typeof usage !== "object" || Array.isArray(usage) || Object.keys(usage).some(k => !units.includes(k))) {
        throw Error()
      }
      const counts = units.map(key => {
        const value = usage[key]
        if (value === undefined) return null
        if ((typeof value !== "string" && typeof value !== "number") || !/^\d+$/.test(String(value))) throw Error()
        return Number(value)
      })
      rows.push(cursorItem.parse({
        itemId: row["Billing Item ID"], occurredAt: row["Event Time"], product: row.Product,
        chargeCategory: row["Charge Category"], usageType: row["Usage Type"], currency: row["Pricing Currency"] || null,
        contracted: row["Pricing Contracted"] || null, model: row.Model || null,
        promptTokens: counts[0], completionTokens: counts[1], cachedPromptTokens: counts[2], cacheWriteTokens: counts[3],
      }))
    } catch {
      throw Error(`Invalid billing values or unsupported usage units in record ${index + 1}.`)
    }
  }
  return { rows, skipped }
}
