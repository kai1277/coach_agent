export type SeedQuestion = { theme: string; text: string };

function extractFirstJSONBlock(s: string): any | null {
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const tryParse = (t: string) => {
    try {
      return JSON.parse(t);
    } catch {
      return null;
    }
  };
  if (fence?.[1]) {
    const obj = tryParse(fence[1].trim());
    if (obj) return obj;
  }
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    const obj = tryParse(s.slice(start, end + 1));
    if (obj) return obj;
  }
  return tryParse(s.trim());
}

function sanitizeQuestions(qs: any, n: number): SeedQuestion[] {
  if (!Array.isArray(qs)) return [];
  const seen = new Set<string>();
  const out: SeedQuestion[] = [];
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

async function openaiChatJSON(args: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
}) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.apiKey}`,
    },
    body: JSON.stringify({
      model: args.model,
      temperature: 0.7,
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: args.user },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenAI request failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  const content =
    data?.choices?.[0]?.message?.content ??
    data?.choices?.[0]?.message ??
    data?.choices?.[0] ??
    "";
  const text =
    typeof content === "string"
      ? content
      : typeof content?.content === "string"
      ? content.content
      : String(content ?? "");
  return extractFirstJSONBlock(text);
}

function buildSeedPrompt(strengths: string[], demographics: any, n: number) {
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
ストレングス: ${JSON.stringify(strengths)}
属性: ${JSON.stringify(demographics ?? {})}
個数: ${n}
出力は必ず JSON のみで返してください。
  `.trim();

  return { system, user };
}

export function createLLMClient() {
  const env: any = (import.meta as any)?.env ?? {};
  // 優先度: Vite → Node
  const provider = env.VITE_LLM_PROVIDER || process?.env?.LLM_PROVIDER || "";
  const openaiApiKey =
    env.VITE_OPENAI_API_KEY || process?.env?.OPENAI_API_KEY || "";
  const openaiModel =
    env.VITE_OPENAI_MODEL || process?.env?.OPENAI_MODEL || "gpt-4o-mini";

  const enabled = provider === "openai" && !!openaiApiKey;

  const client = enabled
    ? {
        async generateCoachOutput(_: {
          transcript: string;
          context: string | null;
          strengths_top5: string[] | null;
          instruction: string | null;
        }) {
          // 最小実装（今回の主目的ではない）
          return {
            summary: "（LLM要約のダミー）",
            hypotheses: [],
            next_steps: [],
            citations: [],
            counter_questions: [],
          };
        },

        async generateSeedQuestions(input: {
          strengths_top5?: string[];
          demographics?: {
            ageRange?: string;
            gender?: string;
            hometown?: string;
          };
          n?: number;
        }): Promise<{ questions: SeedQuestion[] }> {
          const n = Math.max(1, Math.min(Number(input?.n ?? 5), 10));
          const strengths = Array.isArray(input?.strengths_top5)
            ? input!.strengths_top5.slice(0, 5)
            : [];
          const demo = input?.demographics ?? {};
          const { system, user } = buildSeedPrompt(strengths, demo, n);

          const obj = await openaiChatJSON({
            apiKey: openaiApiKey,
            model: openaiModel,
            system,
            user,
          });

          let raw: any = null;
          if (obj && typeof obj === "object") {
            raw =
              obj.questions ??
              obj?.data?.outputs?.questions ??
              obj?.outputs?.questions ??
              null;
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
      }
    : null;

  return { enabled, client };
}
