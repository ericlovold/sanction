import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono, Space_Grotesk } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import "./globals.css"

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] })
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] })
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
})
export const metadata: Metadata = {
  metadataBase: new URL("https://getsanction.com"),
  title: "Sanction — Stop runaway AI API spend",
  description:
    "Put hard limits in front of AI spend, MCP tools, and x402 payments. Sanction authorizes the spend; any rail settles it.",
  openGraph: {
    title: "Your agent can run. Your API bill can't.",
    description: "Put hard limits in front of AI spend, MCP tools, and x402 payments. Sanction authorizes the spend; any rail settles it.",
    url: "https://getsanction.com",
    siteName: "Sanction",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Your agent can run. Your API bill can't.",
    description: "Put hard limits in front of AI spend, MCP tools, and x402 payments. Sanction authorizes the spend; any rail settles it.",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Sanction",
  },
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f6" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
}

// Applied before first paint so the theme never flashes. Light is the default —
// the governance console reads as a secure instrument (deep-pine rail, hairline
// workpaper), so a first visit renders light regardless of OS preference. Dark is
// opt-in via the toggle and persists in localStorage. (A dark OS no longer forces
// the console dark; only an explicit stored 'dark' does.)
const themeScript = `(function(){try{if(localStorage.getItem('sanction-theme')==='dark'){document.documentElement.classList.add('dark')}}catch(e){}})()`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${spaceGrotesk.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
        <Analytics />
      </body>
    </html>
  )
}
