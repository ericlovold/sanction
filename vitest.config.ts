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
      exclude: ["lib/generated/**", "lib/openapi.ts", "lib/db.ts", "lib/log.ts", "**/*.d.ts"],
      reporter: ["text-summary"],
      // Ratchet floor — set just below current so coverage can't silently
      // regress. Raise as coverage grows; never lower.
      thresholds: {
        statements: 38,
        lines: 38,
        functions: 58,
        branches: 72,
      },
    },
  },
})
