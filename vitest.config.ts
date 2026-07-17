import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"

export default defineConfig({
  // `@/...` so tests can import route handlers (which import @/lib/*).
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: {
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts", "app/api/**/*.ts"],
      // Generated client + static data/infra carry no logic worth covering.
      // changelog/roadmap/docs/integrations are page CONTENT (prose, SVG paths);
      // auth-client is the client-bundle Better Auth stub. None hold decisions.
      exclude: [
        "lib/generated/**",
        "lib/openapi.ts",
        "lib/db.ts",
        "lib/log.ts",
        "lib/changelog.ts",
        "lib/roadmap.ts",
        "lib/docs.ts",
        "lib/integrations.ts",
        "lib/auth-client.ts",
        "**/*.d.ts",
      ],
      reporter: ["text-summary"],
      // Ratchet floor — set just below current so coverage can't silently
      // regress. Raise as coverage grows; never lower.
      thresholds: {
        // Ratchet (2026-07-17): measured 89.87 / 89.87 / 93.86 / 83.22 after
        // the role-gating + wallet-switcher suites — raise, never lower.
        statements: 89.5,
        lines: 89.5,
        functions: 93.5,
        branches: 83,
      },
    },
  },
})
