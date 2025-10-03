type StrengthsTop5 = string[];
type Demographics = { ageRange?: string; gender?: string; hometown?: string };

export type SeedArgs = {
  strengths_top5: StrengthsTop5;
  demographics?: Demographics;
  n?: number;
};

export type SeedQuestion = { theme: string; text: string };

export interface LLMClient {
  // 既存: セッション出力の再生成（最小モック）
  generateCoachOutput(_: {
    transcript: string;
    context: string | null;
    strengths_top5: string[] | null;
    instruction: string | null;
  }): Promise<{
    summary: string;
    hypotheses: string[];
    next_steps: string[];
    citations: { text: string; anchor: string }[];
    counter_questions: string[];
  }>;

  // 追加: 種質問の生成（Dify/他のLLM接続）
  generateSeedQuestions?(
    args: SeedArgs
  ): Promise<{ questions: SeedQuestion[] }>;
}

function sanitizeQuestions(qs: any, n: number): SeedQuestion[] {
  if (!Array.isArray(qs)) return [];
  const out: SeedQuestion[] = [];
  const seen = new Set<string>();
  for (const it of qs) {
    const theme = String(it?.theme ?? "").trim() || "汎用";
    const text = String(it?.text ?? it?.question ?? "").trim();
    if (!text) continue;
    const key = `${theme}::${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ theme, text: text.slice(0, 300) });
    if (out.length >= Math.max(1, n)) break;
  }
  return out;
}

export function createLLMClient(): { enabled: boolean; client: LLMClient } {
  const provider = (import.meta as any).env?.VITE_LLM_PROVIDER as
    | string
    | undefined;
  const difyEndpoint = (import.meta as any).env?.VITE_DIFY_SEED_API as
    | string
    | undefined;
  const difyApiKey = (import.meta as any).env?.VITE_DIFY_API_KEY as
    | string
    | undefined;

  const enabled = !!(provider === "dify" && difyEndpoint && difyApiKey);

  // ---- Dify 実装 ----
  if (enabled) {
    const client: LLMClient = {
      async generateCoachOutput(_) {
        // （最小実装：ここはモックでOK。既存の挙動を維持）
        return {
          summary: "（LLM要約のダミー）",
          hypotheses: [],
          next_steps: [],
          citations: [],
          counter_questions: [],
        };
      },

      async generateSeedQuestions(args: SeedArgs) {
        const n = Math.max(1, Math.min(Number(args?.n || 5), 10));

        // ★ 重要：Dify 側が paragraph(=string) 入力のため、JSON 文字列にして送る
        const strengthsAsStr = JSON.stringify(args?.strengths_top5 ?? []);
        const demoAsStr = JSON.stringify(args?.demographics ?? {});

        const res = await fetch(difyEndpoint!, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${difyApiKey}`,
          },
          body: JSON.stringify({
            inputs: {
              strengths_top5: strengthsAsStr, // ← 文字列
              demographics: demoAsStr, // ← 文字列
              n, // ← 数値は数値のままでOK
            },
            response_mode: "blocking",
            user: "seed-generator",
          }),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`Dify request failed: ${res.status} ${text}`);
        }
        const data = await res.json();

        // 出力の取り出し（outputs.questions / data.outputs.questions / questions のいずれか）
        const candidates = [
          data?.outputs?.questions,
          data?.data?.outputs?.questions,
          data?.questions,
        ];
        let raw: any = null;
        for (const c of candidates) {
          if (c != null) {
            raw = c;
            break;
          }
        }

        // サニタイズ＋上限 n 件
        let questions = sanitizeQuestions(raw, n);

        // フォールバック（最低1件）
        if (!questions.length) {
          questions = [
            {
              theme: "汎用",
              text: "最近、仕事で一番うまくいったことは何ですか？",
            },
          ];
        }

        return { questions };
      },
    };

    return { enabled: true, client };
  }

  // ---- フォールバック（ローカルのみ）----
  const client: LLMClient = {
    async generateCoachOutput(_) {
      return {
        summary: "（ローカル要約のダミー）",
        hypotheses: [],
        next_steps: [],
        citations: [],
        counter_questions: [],
      };
    },
    // generateSeedQuestions は未提供（ハンドラ側でフォールバック）
  };

  return { enabled: false, client };
}
