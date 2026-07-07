import type { MetadataRoute } from "next"

// PWA manifest — makes /dashboard installable ("Add to Home Screen"): app icon,
// full-screen standalone, opens straight to the dashboard.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sanction — Agent Governance",
    short_name: "Sanction",
    description: "Approve, cap, and audit what your AI agents spend and access — from anywhere.",
    // Open where the operator's #1 job lives: the approval queue. Overview is
    // one tap away; the notification-driven "approve and leave" path starts here.
    start_url: "/dashboard/approvals",
    scope: "/",
    shortcuts: [
      { name: "Approvals", url: "/dashboard/approvals", description: "Resolve pending agent requests" },
      { name: "Seats", url: "/dashboard/agents", description: "Manage agent seats and key lifecycle" },
      { name: "Execution", url: "/dashboard/tokens", description: "Observe and revoke execution tokens" },
      { name: "Spend", url: "/dashboard/spend", description: "Budgets and burn" },
    ],
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
