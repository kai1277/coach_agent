/**
 * LLM/Dify クライアント（ブラウザMSWのモックからも使う前提の軽実装）
 * - generateCoachOutput(...) は既存互換
 * - generateSeedQuestions(...) を追加
 *
 * .env 例:
 *  VITE_LLM_PROVIDER=dify
 *  VITE_DIFY_SEED_API=https://api.dify.ai/v1/workflows/run        // or Apps endpoint
 *  VITE_DIFY_API_KEY=xxxx
 */

export type SeedQuestion = { theme: string; text: string };

export function createLLMClient() {
  const env: any = (import.meta as any)?.env ?? {};
  const provider = env.VITE_LLM_PROVIDER || process?.env?.LLM_PROVIDER || "";
  const difySeedApi =
    env.VITE_DIFY_SEED_API || process?.env?.DIFY_SEED_API || "";
  const difyApiKey = env.VITE_DIFY_API_KEY || process?.env?.DIFY_API_KEY || "";

  const enabled = provider === "dify" && !!difySeedApi && !!difyApiKey;

  async function postJSON(url: string, body: any) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${difyApiKey}`,
      },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) {
      const msg = json?.message || json?.error || "LLM request failed";
      throw new Error(msg);
    }
    return json;
  }

  const client = enabled
    ? {
        // 既存：成果物生成（なければスキップ可）
        async generateCoachOutput(args: {
          transcript: string;
          context: string | null;
          strengths_top5: string[] | null;
          instruction: string | null;
        }) {
          // ここは既存のまま/簡易ダミーでもOK（本件では未使用でもよい）
          return {
            summary: `要約: ${args.transcript.slice(0, 60)}…`,
            hypotheses: ["仮説A", "仮説B"],
            next_steps: ["次の一歩A", "次の一歩B"],
            citations: [],
            counter_questions: ["反証1"],
          };
        },

        // 新規：Top5(+demographics)から「資質ベース質問」を生成
        async generateSeedQuestions(input: {
          strengths_top5?: string[];
          demographics?: {
            ageRange?: string;
            gender?: string;
            hometown?: string;
          };
          n?: number; // 目安の質問数
        }): Promise<{ questions: SeedQuestion[] }> {
          const n = input.n ?? 5;
          // Difyのワークフロー/アプリに合わせてペイロードを調整してね
          const payload = {
            inputs: {
              strengths_top5: input.strengths_top5 ?? [],
              demographics: input.demographics ?? {},
              n,
            },
            response_mode: "blocking",
          };
          const json = await postJSON(difySeedApi, payload);

          // 期待する返り値に正規化（WorkflowのSchemaに合わせて編集）
          const items: any[] =
            json?.data?.outputs?.questions ||
            json?.questions ||
            json?.data ||
            [];

          const questions: SeedQuestion[] = items
            .map((it) => ({
              theme: String(it.theme || it.tag || "不明"),
              text: String(it.text || it.question || ""),
            }))
            .filter((q) => q.text);

          return { questions };
        },
      }
    : null;

  return { enabled, client };
}
