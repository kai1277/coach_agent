type StrengthsTop5 = string[];
type Demographics = { ageRange?: string; gender?: string; hometown?: string };

export type SeedArgs = {
  strengths_top5: StrengthsTop5;
  demographics?: Demographics;
  n?: number;
};

export type SeedQuestion = { theme: string; text: string };

export interface LLMClient {
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

  generateSeedQuestions?(
    args: SeedArgs
  ): Promise<{ questions: SeedQuestion[] }>;
}

function sanitizeQuestions(qs: any, n: number): SeedQuestion[] {
  if (!Array.isArray(qs)) return [];
  const out: SeedQuestion[] = [];
  const seen = new Set<string>();
  for (const it of qs) {
    const theme =
      String(
        it?.theme ?? it?.strength ?? it?.trait ?? it?.category ?? ""
      ).trim() || "汎用";
    const text = String(it?.text ?? it?.question ?? it?.q ?? "").trim();
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
  const env = (import.meta as any).env ?? {};

  // ====== Dify 既存経路 ======
  const provider = env.VITE_LLM_PROVIDER as string | undefined;
  const difyEndpoint = env.VITE_DIFY_SEED_API as string | undefined;
  const difyApiKey = env.VITE_DIFY_API_KEY as string | undefined;

  // ====== OpenAI 直叩き（追加） ======
  const openaiApiKey = env.VITE_OPENAI_API_KEY as string | undefined;
  const openaiModel =
    (env.VITE_OPENAI_MODEL as string | undefined) || "gpt-4o-mini";

  // --- OpenAI 実装 ---
  if (provider === "openai" && openaiApiKey) {
    const client: LLMClient = {
      async generateCoachOutput(_) {
        // 必要なら後でちゃんと実装。今はダミーを返す
        return {
          summary: "（OpenAI要約のダミー）",
          hypotheses: [],
          next_steps: [],
          citations: [],
          counter_questions: [],
        };
      },

      async generateSeedQuestions(args: SeedArgs) {
        const n = Math.max(1, Math.min(Number(args?.n || 5), 10));

        // LLMへの指示（Difyのsystemプロンプトを移植）
        const system = `
あなたは1on1のための質問設計エージェントです。
入力の strengths_top5, demographics, n に基づき、
{ "questions": [ { "theme": "<資質名>", "text": "<日本語の質問文>" }, ... ] }
というJSONを厳密に返してください。余計な前置きや説明文は書かないでください。

制約:
- 配列長は n 件
- text は具体的で、5〜40文字程度
- theme は strengths_top5 から選ぶ（不足する場合は最も関連の強い資質名を推定して入れる）
- 質問は YES/NO を想定した短い文にする（例: 「歴史の本が好きですか？」）
`.trim();

        const user = `
ストレングス: ${JSON.stringify(args?.strengths_top5 ?? [])}
属性: ${JSON.stringify(args?.demographics ?? {})}
個数: ${n}
出力は必ず JSON のみで返してください。
`.trim();

        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${openaiApiKey}`,
          },
          body: JSON.stringify({
            model: openaiModel,
            temperature: 0.2,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          }),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`OpenAI request failed: ${res.status} ${text}`);
        }
        const data = await res.json();

        const content: string = data?.choices?.[0]?.message?.content ?? "";

        // JSON抽出（素で返ってくればそのまま、雑に {} を探す）
        let parsed: any = null;
        const fence = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (fence) {
          try {
            parsed = JSON.parse(fence[1]);
          } catch {}
        }
        if (!parsed) {
          const start = content.indexOf("{");
          const end = content.lastIndexOf("}");
          if (start !== -1 && end !== -1 && end > start) {
            try {
              parsed = JSON.parse(content.slice(start, end + 1));
            } catch {}
          }
        }
        if (!parsed) {
          try {
            parsed = JSON.parse(content);
          } catch {}
        }

        const raw =
          parsed?.questions ??
          parsed?.data?.outputs?.questions ??
          parsed?.outputs?.questions ??
          [];

        let questions = sanitizeQuestions(raw, n);
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

  // --- Dify 実装（既存） ---
  const difyEnabled = !!(provider === "dify" && difyEndpoint && difyApiKey);
  if (difyEnabled) {
    const client: LLMClient = {
      async generateCoachOutput(_) {
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
              strengths_top5: strengthsAsStr,
              demographics: demoAsStr,
              n,
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
        const candidates = [
          data?.outputs?.questions,
          data?.data?.outputs?.questions,
          data?.questions,
        ];
        let raw: any = null;
        for (const c of candidates)
          if (c != null) {
            raw = c;
            break;
          }
        let questions = sanitizeQuestions(raw, n);
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

  // --- フォールバック（ローカルのみ） ---
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
  };
  return { enabled: false, client };
}
