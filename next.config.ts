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
      // The consulting practice moved to ericlovold.com (2026-07-29). Sanction is the
      // product; the SMB/executive consulting buyer is a different person entirely.
      // Kept as a redirect rather than a delete so existing inbound links survive.
      {
        source: "/consulting",
        destination: "https://ericlovold.com",
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
