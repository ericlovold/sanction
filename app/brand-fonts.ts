import { Instrument_Sans, IBM_Plex_Mono, Jost } from "next/font/google"

// Marketing-only faces (brand.css maps them into --font-sans/--font-mono/
// --font-label). Scoped here so the dashboard/PWA never pays their preload —
// apply `brandFontVars` on the root element of any page that imports brand.css.
const instrumentSans = Instrument_Sans({
  variable: "--font-instrument",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
})
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
})
const jost = Jost({
  variable: "--font-jost",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
})

export const brandFontVars = `${instrumentSans.variable} ${plexMono.variable} ${jost.variable}`
