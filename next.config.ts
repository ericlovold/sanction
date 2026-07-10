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
      // The footer link is labeled "Consulting" — people type /consulting and
      // 404 (external reviewers concluded the services offer didn't exist).
      // Temporary so a real /consulting page can claim the path later.
      {
        source: "/consulting",
        destination: "/about",
        permanent: false,
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
