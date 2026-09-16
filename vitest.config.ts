import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    isolate: false,
    coverage: {
      provider: "v8",
      include: ["src/**"],
      thresholds: {
        lines: 25,
        functions: 25,
        branches: 25,
        statements: 25,
      },
    },
  },
});
