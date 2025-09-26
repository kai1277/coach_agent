import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";

type ToastType = "info" | "success" | "error";
type Toast = { id: string; message: string; type: ToastType; duration: number };

type ToastContextValue = {
  show: (
    message: string,
    opts?: { type?: ToastType; duration?: number }
  ) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback(
    (message: string, opts?: { type?: ToastType; duration?: number }) => {
      const t: Toast = {
        id: Math.random().toString(36).slice(2),
        message,
        type: opts?.type ?? "info",
        duration: Math.max(800, Math.min(opts?.duration ?? 2600, 10000)),
      };
      setToasts((xs) => [...xs, t]);
    },
    []
  );

  useEffect(() => {
    const timers = toasts.map((t) =>
      setTimeout(
        () => setToasts((xs) => xs.filter((x) => x.id !== t.id)),
        t.duration
      )
    );
    return () => timers.forEach(clearTimeout);
  }, [toasts]);

  const value = useMemo<ToastContextValue>(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-80 flex-col gap-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              role="status"
              aria-live="polite"
              className={`pointer-events-auto rounded-lg border px-3 py-2 text-sm shadow ${
                t.type === "success"
                  ? "border-green-300 bg-green-50 text-green-900"
                  : t.type === "error"
                  ? "border-red-300 bg-red-50 text-red-900"
                  : "border-gray-300 bg-white text-gray-900"
              }`}
            >
              {t.message}
            </div>
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("ToastProvider is missing");
  return ctx.show;
}
