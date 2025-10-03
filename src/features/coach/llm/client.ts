export function createLLMClient() {
  const env = (import.meta as any).env ?? {};
  const provider = env.VITE_LLM_PROVIDER ?? "local";

  // dify 以外（またはENV未設定）は無効化 → 既存のフォールバックに任せる
  if (provider !== "dify") {
    return { enabled: false as const, client: null as any };
  }

  const endpoint = env.VITE_DIFY_SEED_API;
  const apiKey = env.VITE_DIFY_API_KEY;

  if (!endpoint || !apiKey) {
    // 設定不備 → 無効化
    return { enabled: false as const, client: null as any };
  }

  // 必要ならここに Dify 呼び出しロジックを実装
  // 今回は「セッション出力（要約など）」に使っている既存のAPI名に整合だけ取る
  const client = {
    async generateCoachOutput(_: {
      transcript: string;
      context: string | null;
      strengths_top5: string[] | null;
      instruction: string | null;
    }) {
      // ここを実装する場合は endpoint/apiKey を使って Dify を叩く
      // ひとまず “通る” ダミーを返す（MSW落ちを回避）
      return {
        summary: "（LLM省略）初期要約",
        hypotheses: ["（LLM省略）仮説A", "仮説B"],
        next_steps: ["（LLM省略）次の一歩1", "2"],
        citations: [{ text: "dummy", anchor: "#t=0:00" }],
        counter_questions: ["（LLM省略）反証質問の例"],
      };
    },
  };

  return { enabled: true as const, client };
}
