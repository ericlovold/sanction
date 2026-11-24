import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { RunwayChart } from "@/components/runway-chart"

describe("monthly chart accessible values", () => {
  it("provides daily and cumulative values in a native disclosure table", () => {
    const html = renderToStaticMarkup(<RunwayChart label="Model spend" dailyTotals={[2, 3, 99]} now={new Date(2026, 10, 2, 12)} />)
    expect(html).toContain('<summary>View daily values for model spend</summary>')
    expect(html).toContain('<caption>Model spend in Nov: recorded daily and cumulative totals</caption>')
    expect(html).toContain('<th scope="row">Nov 1</th><td>$2.00</td><td>$2.00</td>')
    expect(html).toContain('<th scope="row">Nov 2</th><td>$3.00</td><td>$5.00</td>')
    expect(html).not.toContain('$99.00')
    expect(html).not.toContain('aria-hidden="true"><summary>')
  })
})
