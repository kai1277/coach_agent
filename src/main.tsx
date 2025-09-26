import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CoachRoute from "./app/routes/app/coach";
import "./index.css";
import { ToastProvider } from "./ui/ToastProvider";

// MSW: 開発時 + モックモードのみ 起動
const MODE = (import.meta as any).env?.VITE_API_MODE ?? "mock";
if (import.meta.env.DEV && MODE !== "real") {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  import("./testing/mocks/dev-boot");
}

const qc = new QueryClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/app/coach" element={<CoachRoute />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
