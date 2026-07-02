import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono, Space_Grotesk, Instrument_Sans, IBM_Plex_Mono, Jost } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import "./globals.css"

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] })
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] })
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
})
// Sanction brand fonts (marketing surface). Instrument Sans is the licensed-free
// stand-in for Neue Haas Grotesk; IBM Plex Mono is the mono voice.
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
// Free Futura revival — the web fallback behind real Futura/Avenir (Mac-only,
// proprietary) for the geometric eyebrow labels.
const jost = Jost({
  variable: "--font-jost",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
})

export const metadata: Metadata = {
  metadataBase: new URL("https://getsanction.com"),
  title: "Sanction — The authorization layer for AI agents",
  description:
    "Sanction is the authorization and credential layer for autonomous AI agents: set spend limits, approve or deny each action before it runs, and inject short-lived scoped secrets — across MCP, REST, and AWS Bedrock.",
  openGraph: {
    title: "Sanction — The authorization layer for AI agents",
    description: "Don't give your agent your credit card. Give it a Sanction key — spend limits, scoped secrets, and an audit trail for autonomous AI agents.",
    url: "https://getsanction.com",
    siteName: "Sanction",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Sanction — The authorization layer for AI agents",
    description: "Don't give your agent your credit card. Give it a Sanction key — spend limits, scoped secrets, and an audit trail for autonomous AI agents.",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Sanction",
  },
}

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${geistSans.variable} ${geistMono.variable} ${spaceGrotesk.variable} ${instrumentSans.variable} ${plexMono.variable} ${jost.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-zinc-950 text-zinc-100">
        {children}
        <Analytics />
      </body>
    </html>
  )
}
