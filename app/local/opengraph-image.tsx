import { ImageResponse } from "next/og"

// The LinkedIn/social card for /local — the keycard look: deep pine gradient,
// cream type, gold chip. Kept in sync by eye with AccessKeyCard (app/page.tsx).

export const alt = "Sanction Local — Private AI that never leaves your building"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: "linear-gradient(135deg, #124A3A 0%, #0C332A 55%, #0A2B23 100%)",
          color: "#EDE9DC",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: 5 }}>SANCTION</div>
            <div style={{ fontSize: 20, letterSpacing: 3, color: "rgba(120,224,178,0.9)", marginTop: 10 }}>
              SANCTION LOCAL
            </div>
          </div>
          <div
            style={{
              width: 84,
              height: 62,
              borderRadius: 12,
              background: "linear-gradient(135deg, #EED9A0 0%, #D4AF5E 45%, #B58328 100%)",
            }}
          />
        </div>

        <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.08, letterSpacing: -2, maxWidth: 980 }}>
          Private AI that never leaves your building.
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 24 }}>
          <div style={{ color: "rgba(237,233,220,0.75)" }}>
            Local models · zero egress by design · assessor-ready audit trail
          </div>
          <div style={{ color: "rgba(120,224,178,0.9)" }}>getsanction.com/local</div>
        </div>
      </div>
    ),
    { ...size },
  )
}
