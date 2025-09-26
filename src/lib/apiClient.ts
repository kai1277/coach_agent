import type {
  Session,
  StrengthTheme,
  LoopFetch,
  Answer5,
  ApiError,
  Demographics,
} from "../types/api";

const API_MODE = (import.meta as any).env?.VITE_API_MODE ?? "mock"; // 'mock' | 'real'
const API_BASE =
  API_MODE === "real" ? (import.meta as any).env?.VITE_API_BASE_URL ?? "" : "";

/**
 * ✅ named export: apiClient
 * - 生の fetch(Response) を返す薄いラッパー
 * - 呼び出し側で res.ok チェック → res.json() する使い方に対応
 */
export async function apiClient(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  // 文字列/URL のときは API_BASE を前置
  const url =
    typeof input === "string" || input instanceof URL
      ? `${API_BASE}${input}`
      : input;

  // Content-Type の補完（body がある場合のみ）
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(url as any, { ...init, headers });
}

/**
 * 既存の高級API: JSON パース & エラー整形まで面倒を見るヘルパ
 * - 下層では apiClient を利用
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiClient(path, init);
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* no body */
  }
  if (!res.ok) {
    const err =
      data && typeof data === "object" && "message" in data
        ? (data as ApiError).message
        : res.statusText;
    throw new Error(err || "Request failed");
  }
  return data as T;
}

/**
 * 便利メソッド群（そのまま維持）
 * - /features 側で使っている場合も互換
 * - /actions はサーバの仕様に合わせてキー名を instruction に統一
 */
export const api = {
  sessions: {
    create(payload: {
      transcript: string;
      context?: "人間関係" | "仕事" | "プライベート";
      strengths_top5?: StrengthTheme[];
      demographics?: Demographics; // ★ 追加
    }) {
      return request<Session>("/api/sessions", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    get(id: string) {
      return request<Session>(`/api/sessions/${id}`);
    },
    action(id: string, instruction: string) {
      // サーバ側は { instruction } を期待
      return request<Session>(`/api/sessions/${id}/actions`, {
        method: "POST",
        body: JSON.stringify({ instruction }),
      });
    },
    getNext(id: string) {
      return request<LoopFetch>(`/api/sessions/${id}/questions/next`);
    },
    answer(id: string, body: { questionId: string; answer: Answer5 }) {
      return request<LoopFetch>(`/api/sessions/${id}/answers`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    undo(id: string) {
      return request<LoopFetch>(`/api/sessions/${id}/answers/undo`, {
        method: "POST",
      });
    },
    patchLoop(
      id: string,
      body: { threshold?: number; maxQuestions?: number; minQuestions?: number }
    ) {
      return request<{
        ok: true;
        loop: { threshold: number; maxQuestions: number; minQuestions: number };
      }>(`/api/sessions/${id}/loop`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    },
  },
};

// 実APIへ切替したいとき：.env.* で VITE_API_MODE=real と VITE_API_BASE_URL を設定
