import { useMutation } from "@tanstack/react-query";
import { api } from "../../../lib/apiClient";
import type { Session } from "../../../types/api";

export function useNextStep(sessionId: string | null) {
  return useMutation({
    // ここは文字列を受け取る
    mutationFn: async (instruction: string) => {
      if (!sessionId) throw new Error("no session id");
      // 第2引数は { instruction } ではなく instruction（文字列）
      return api.sessions.action(sessionId, instruction);
    },
    onError: (e: any) => {
      console.error("next step failed", e);
    },
  }) as any as {
    mutateAsync: (instruction: string) => Promise<Session>;
    isPending: boolean;
    isError: boolean;
    error: unknown;
    reset: () => void;
    data?: Session;
  };
}
