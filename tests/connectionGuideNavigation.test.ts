import { describe, expect, it } from "vitest"
import { connectionFragment, connectionHosts, parseConnectionFragment } from "@/lib/connectionGuideNavigation"

describe("connection guide fragments", () => {
  it.each(["", "#troubleshooting", "#step=check", "#host=unknown&step=request", "#host=%E0%A4%A&step=check"])(
    "leaves the host unselected for %s", (fragment) => {
      expect(parseConnectionFragment(fragment)).toEqual({ host: null, step: 0 })
    },
  )

  it.each(connectionHosts)("restores each supported step for $name", (host) => {
    for (const [step, slug] of ["connect", "check", "request"].entries()) {
      expect(parseConnectionFragment(`#host=${host.slug}&step=${slug}`)).toEqual({
        host,
        step: host.slug === "chatgpt" ? 0 : step,
      })
    }
  })

  it.each(["", "unknown", "-1", "3", "Check", "constructor", "__proto__"])(
    "falls back to Connect for an unsupported step %s", (step) => {
      expect(parseConnectionFragment(`#host=claude&step=${step}`).step).toBe(0)
    },
  )

  it("ignores unrelated state and serializes only the navigation selection", () => {
    const parsed = parseConnectionFragment("#host=claude&step=check&connected=true&token=example")
    expect(parsed).toEqual({ host: connectionHosts[0], step: 1 })
    expect(connectionFragment(parsed.host!, parsed.step)).toBe("#host=claude&step=check")
  })

  it("generates only supported steps, including ChatGPT's availability view", () => {
    expect(connectionFragment(connectionHosts[0], 2)).toBe("#host=claude&step=request")
    expect(connectionFragment(connectionHosts[0], 99)).toBe("#host=claude&step=connect")
    expect(connectionFragment(connectionHosts[5], 2)).toBe("#host=chatgpt&step=connect")
  })
})
