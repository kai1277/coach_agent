import { useQuery } from "@tanstack/react-query";
import { api } from "../../../lib/apiClient";
import type { Turn } from "../../../types/api";

export function useTurns(sessionId: string | undefined) {
  return useQuery({
    queryKey: ["turns", sessionId],
    enabled: !!sessionId,
    queryFn: async (): Promise<Turn[]> => {
      if (!sessionId) return [];
      return api.sessions.listTurns(sessionId, { order: "asc", limit: 200 });
    },
  });
}
