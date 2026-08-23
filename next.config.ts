import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "getsanction.vercel.app" }],
        destination: "https://getsanction.com/:path*",
        permanent: true,
      },
      // 2026-08 reposition: the homepage IS the services page now, so the old
      // consulting page redirects into it. Kept permanent for link equity.
      {
        source: "/consulting",
        destination: "/",
        permanent: true,
      },
      // 2026-08: the Moral Intention Analyst moved to its own site, so this
      // repo is the authorization product only. Permanent, and cross-origin —
      // anything still linking to the old page lands on the real one instead
      // of a 404.
      {
        source: "/moral-intention",
        destination: "https://moralintention.com",
        permanent: true,
      },
      {
        source: "/moral-intention/:path*",
        destination: "https://moralintention.com/:path*",
        permanent: true,
      },
    ];
  },
  // Standard security headers — a clean posture helps reputation/scanner scores.
  // Deliberately no strict CSP here (would need per-route tuning to avoid breakage).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
