import { useEffect } from "react";

export default function HealthCheck() {
  useEffect(() => {
    (async () => {
      const res = await fetch("http://localhost:8787/health", {
        method: "GET",
        credentials: "include", // Cookie使わないなら消してOK
        headers: { "Content-Type": "application/json" },
      });
      const text = await res.text();
      console.log("health:", text); // 期待: "ok"
    })().catch(console.error);
  }, []);

  return null; // 画面には何も表示しない
}
