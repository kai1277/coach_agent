import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./src/testing/tests/setup.ts"],
    include: ["src/testing/tests/**/*.spec.ts"],
  },
});
