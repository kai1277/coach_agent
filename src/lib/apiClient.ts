import type {
  Session,
  StrengthTheme,
  LoopFetch,
  Answer5,
  ApiError,
  Demographics,
  Turn,
} from "../types/api";

const API_MODE = (import.meta as any).env?.VITE_API_MODE ?? "mock"; // 'mock' | 'real'
const API_BASE =
  API_MODE === "real" ? (import.meta as any).env?.VITE_API_BASE_URL ?? "" : "";

/**
 * 生の fetch を返す薄いラッパー
 */
export async function apiClient(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  // 相対パスなら API_BASE を前置
  let url: string | URL = input as any;
  if (typeof input === "string") {
    const isAbsolute = /^https?:\/\//i.test(input);
    url = isAbsolute ? input : `${API_BASE}${input}`;
  } else if (input instanceof URL) {
    url = input;
  }

  const headers = new Headers(init.headers);
  const hasBody = init.body != null;
  const isMultipart =
    typeof FormData !== "undefined" && init.body instanceof FormData;
  const isBlob = typeof Blob !== "undefined" && init.body instanceof Blob;

  if (!headers.has("Content-Type") && hasBody && !isMultipart && !isBlob) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(url as any, {
    // 認証が必要ならコメントアウトを外す
    // credentials: "include",
    ...init,
    headers,
  });
}

/**
 * JSON パース & エラー整形 & {data:...} アンラップ
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiClient(path, init);

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  if (!res.ok) {
    const msg =
      (json &&
        typeof json === "object" &&
        (("message" in json && (json as ApiError).message) ||
          ("error" in json && String((json as any).error)))) ||
      res.statusText ||
      "Request failed";
    throw new Error(msg);
  }

  const unwrapped =
    json && typeof json === "object" && "data" in json ? (json as any).data : json;

  return unwrapped as T;
}

/**
 * 高級API: /api/sessions 系
 */
export const api = {
  sessions: {
    create(payload: {
      transcript: string;
      context?: "人間関係" | "仕事" | "プライベート";
      strengths_top5?: StrengthTheme[];
      demographics?: Demographics;
    }) {
      return request<Session>("/api/sessions", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    get(id: string) {
      return request<Session>(`/api/sessions/${id}`);
    },
    // /actions は instruction キーで統一
    action(id: string, instruction: string) {
      return request<Session>(`/api/sessions/${id}/actions`, {
        method: "POST",
        body: JSON.stringify({ instruction }),
      });
    },
    actions(id: string, instruction: string) {
      // 互換のためのエイリアス（内部は action と同じ）
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
    seedQuestions(
      id: string,
      body: { strengths_top5?: string[]; demographics?: any; n?: number }
    ) {
      return request<{ questions?: any[]; seed_questions?: string[] }>(
        `/api/sessions/${id}/seed-questions`,
        { method: "POST", body: JSON.stringify(body) }
      );
    },
    listTurns(
      id: string,
      opts: { order?: "asc" | "desc"; limit?: number } = {}
    ) {
      const qs = new URLSearchParams();
      if (opts.order) qs.set("order", opts.order);
      if (opts.limit) qs.set("limit", String(opts.limit));
      const q = qs.toString();
      return request<{ turns: Turn[] }>(
        `/api/sessions/${id}/turns${q ? `?${q}` : ""}`
      ).then(r => r.turns ?? []);
    },
    list(params?: { limit?: number }) {
      const q = new URLSearchParams();
      if (params?.limit) q.set("limit", String(params.limit));
      const qs = q.toString() ? `?${q.toString()}` : "";
      return request<Array<{ id: string; title?: string | null; created_at: string }>>(`/api/sessions${qs}`);
    },
    remove(id: string) {
      return request<{ ok: true }>(`/api/sessions/${id}`, { method: "DELETE" });
    },
  },
};
