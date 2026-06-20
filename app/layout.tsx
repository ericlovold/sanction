import type { Metadata } from "next"
import { Geist, Geist_Mono, Space_Grotesk } from "next/font/google"
import "./globals.css"

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] })
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] })
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
})

export const metadata: Metadata = {
  metadataBase: new URL("https://onesanction.com"),
  title: "Sanction — Financial control for autonomous AI agents",
  description:
    "Track and cap what every AI agent spends, and approve, gate, or deny each action before the money moves or a secret is used. One key governs spend and access.",
  openGraph: {
    title: "Sanction — Financial control for autonomous AI agents",
    description: "Don't give your agent your credit card. Give it a Sanction key.",
    url: "https://onesanction.com",
    siteName: "Sanction",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Sanction — Financial control for autonomous AI agents",
    description: "Don't give your agent your credit card. Give it a Sanction key.",
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${geistSans.variable} ${geistMono.variable} ${spaceGrotesk.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-zinc-950 text-zinc-100">{children}</body>
    </html>
  )
}
