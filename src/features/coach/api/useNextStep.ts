import { useMutation } from "@tanstack/react-query";
import { api } from "../../../lib/apiClient";
import type { Session } from "../../../types/api";

export function useNextStep(sessionId: string | null) {
  return useMutation({
    mutationFn: async (input: string) => {
      if (!sessionId) throw new Error("no session");
      return api.sessions.action(sessionId, input);
    },
    onError: (e: any) => {
      console.error("next step failed", e);
    },
  }) as any as {
    mutateAsync: (input: string) => Promise<Session>;
    isPending: boolean;
    isError: boolean;
    error: unknown;
    reset: () => void;
  };
}
