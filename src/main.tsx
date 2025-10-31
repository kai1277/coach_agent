import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CoachRoute from "./app/routes/app/coach";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import UserInfoPage from "./pages/UserInfoPage";
import StrengthsPage from "./pages/StrengthsPage";
import SessionPage from "./pages/SessionPage";
import "./index.css";
import { ToastProvider } from "./ui/ToastProvider";

// MSW: 開発時 + モックモードのみ 起動
const MODE = (import.meta as any).env?.VITE_API_MODE ?? "mock";
if (import.meta.env.DEV && MODE !== "real") {
  import("./testing/mocks/dev-boot"); // ← ここが走ればOK
}

const qc = new QueryClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/user-info" element={<UserInfoPage />} />
            <Route path="/strengths" element={<StrengthsPage />} />
            <Route path="/session" element={<SessionPage />} />
            <Route path="/app/coach" element={<CoachRoute />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
