import type { MetadataRoute } from "next"

// PWA manifest — makes /dashboard installable ("Add to Home Screen"): app icon,
// full-screen standalone, opens straight to the dashboard.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sanction — Agent Governance",
    short_name: "Sanction",
    description: "Approve, cap, and audit what your AI agents spend and access — from anywhere.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    orientation: "portrait-primary",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }
}
