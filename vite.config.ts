import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Vitest 設定
  test: {
    globals: true, // describe/it/expect をグローバルで使えるように（任意）
    environment: "node", // APIレイヤのテストなので node
    setupFiles: ["./src/testing/tests/setup.ts"],
    include: ["src/testing/tests/**/*.spec.ts"],
  },
});
