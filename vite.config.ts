import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // 同一オリジン → Vite が Dify に中継（CORS回避）
      "/__proxy/dify": {
        target: "https://api.dify.ai",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/__proxy\/dify/, ""),
      },
    },
  },
});
