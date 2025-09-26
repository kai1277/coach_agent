import { useMutation } from "@tanstack/react-query";
import { api } from "../../../lib/apiClient";
import type { Session, StrengthTheme } from "../../../types/api";

export function useCreateSession() {
  return useMutation({
    mutationFn: (payload: {
      transcript: string;
      context?: "人間関係" | "仕事" | "プライベート";
      strengths_top5?: StrengthTheme[];
    }) => api.sessions.create(payload),
    onError: (e: any) => {
      console.error("create session failed", e);
    },
  }) as any as {
    mutateAsync: (payload: {
      transcript: string;
      context?: "人間関係" | "仕事" | "プライベート";
      strengths_top5?: StrengthTheme[];
    }) => Promise<Session>;
    isPending: boolean;
    isError: boolean;
    error: unknown;
    reset: () => void;
    data?: Session;
  };
}
