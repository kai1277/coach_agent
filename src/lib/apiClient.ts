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
  // 文字列/URL のときは API_BASE を前置（ただし絶対URLならそのまま）
  let url: string | URL = input as any;
  if (typeof input === "string") {
    const isAbsolute = /^https?:\/\//i.test(input);
    url = isAbsolute ? input : `${API_BASE}${input}`;
  } else if (input instanceof URL) {
    url = input;
  }

  // Content-Type の補完（body があり、かつ FormData/Blob でない場合のみ）
  const headers = new Headers(init.headers);
  const hasBody = init.body != null;
  const isMultipart =
    typeof FormData !== "undefined" && init.body instanceof FormData;
  const isBlob =
    typeof Blob !== "undefined" && init.body instanceof Blob;

  if (!headers.has("Content-Type") && hasBody && !isMultipart && !isBlob) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(url as any, {
    // 認証Cookie等を使うなら有効化（必要なければ削除可）
    // credentials: "include",
    ...init,
    headers,
  });
}

/**
 * 高級API: JSON パース & エラー整形 & {data:...} アンラップ
 * - 下層では apiClient を利用
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiClient(path, init);

  let json: any = null;
  try {
    // レスポンスが空のケースもあり得る
    json = await res.json();
  } catch {
    json = null;
  }

  if (!res.ok) {
    // よくある形 { error: '...', message: '...' } のどちらにも対応
    const msg =
      (json &&
        typeof json === "object" &&
        (("message" in json && (json as ApiError).message) ||
          ("error" in json && String((json as any).error)))) ||
      res.statusText ||
      "Request failed";
    throw new Error(msg);
  }
  // console.debug('[request]', path, res.status, json);

  // { data: {...} } にも素の {...} にも対応
  const unwrapped =
    json && typeof json === "object" && "data" in json ? (json as any).data : json;

  return unwrapped as T;
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
    action(id: string, instruction: string) {
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
  },
};
