import type { SessionOutput } from "../../types/api";
import { buildCoachPrompt, redactPII } from "./prompt";

type GenerateInput = {
  transcript: string;
  context: string | null;
  strengths_top5: string[] | null;
  instruction?: string | null;
};

export function createLLMClient() {
  const env: any = (import.meta as any)?.env ?? {};
  const enabled = String(env.LLM_ENABLED ?? "").toLowerCase() === "true";

  const client = {
    async generateCoachOutput(input: GenerateInput): Promise<SessionOutput> {
      // ここで“必ず”プロンプトを構築（将来の本接続時にこの文字列をPOST）
      const prompt = buildCoachPrompt(input);
      void prompt; // いまは未使用だが、実接続時に使う

      // ダミーでも PII マスクは適用しておく（UIへの戻り値にも反映）
      const masked = redactPII(input.transcript);
      const head = input.instruction
        ? `【指示反映】${input.instruction}\n\n`
        : "";
      const baseSummary = `${head}【要約】${masked.slice(0, 60)}…`;

      return {
        summary: baseSummary,
        hypotheses: [
          "コミュニケーション設計（目的/判断基準）の不一致がある",
          "期待と責任範囲の暗黙のズレが継続している",
          "短期と長期で優先度の見解差がある",
        ],
        next_steps: [
          "次回定例の目的と期待アウトプットを明文化して共有",
          "判断基準（KPI/制約）を1枚で整理",
          "関係者の期待値ヒアリングを3名に実施",
        ],
        citations: [{ text: "会話ログ先頭", anchor: "#t=0:00" }],
        counter_questions: [
          "本当に目的が不明確？例外的に不明だった会だけでは？",
          "判断基準は他文書に明記されていないか？",
        ],
      };
    },
  };

  return { enabled, client };
}
