import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../../lib/apiClient";
import type { StrengthProfile } from "../../../types/api";

export type SessionGetResponse = {
  id: string;
  createdAt?: string;
  output?: {
    summary: string;
    hypotheses: string[];
    next_steps: string[];
    citations: { text: string; anchor: string }[];
    counter_questions?: string[];
    persona?: StrengthProfile;
  };
  loop?: { threshold: number; maxQuestions: number; minQuestions?: number };
  // サーバ実装の“新形”にも多少寛容に
  next_steps?: string[];
  plan?: { next_steps?: string[] };
  seed_questions?: string[];
  summary?: string | null;
  metadata?: any;
};

export function useLoadSession(sessionId: string | null) {
  return useQuery({
    queryKey: ["session", sessionId],
    enabled: !!sessionId,
    queryFn: async () => {
      const res = await apiClient(`/api/sessions/${sessionId}`);
      if (!res.ok) throw new Error(`failed: ${res.status}`);
      const json = await res.json();
      // ★ ここで { data: ... } をアンラップ
      return (json && typeof json === "object" && "data" in json) ? json.data : json;
    },
  });
}