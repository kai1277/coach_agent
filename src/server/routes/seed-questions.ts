import type { Request, Response } from "express";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

function sanitizeTop5(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  return [...new Set(x.map(String))].slice(0, 5);
}

function sanitizeDemo(d: any): {
  ageRange?: string;
  gender?: string;
  hometown?: string;
} {
  if (!d || typeof d !== "object") return {};
  const ageRange = (d.ageRange || d.age || "").toString().trim();
  const gender = (d.gender || "").toString().trim();
  const hometown = (d.hometown || d.home || d.birthplace || "")
    .toString()
    .trim();
  const out: any = {};
  if (ageRange) out.ageRange = ageRange;
  if (gender) out.gender = gender;
  if (hometown) out.hometown = hometown;
  return out;
}

function localSeedQuestionsFromThemes(themes: string[]) {
  const mk = (i: number, theme: string, text: string) => ({
    id: `SQ${i}`,
    theme,
    text,
  });
  const out: { id: string; theme: string; text: string }[] = [];
  let i = 1;
  for (const t of themes.slice(0, 5)) {
    if (t === "原点思考")
      out.push(mk(i++, t, "歴史や由来を調べるのはワクワクしますか？"));
    else if (t === "戦略性")
      out.push(mk(i++, t, "選択肢を並べて最善ルートを素早く選べますか？"));
    else if (t === "着想")
      out.push(mk(i++, t, "新しい切り口を思いつく瞬間がよくありますか？"));
    else if (t === "コミュニケーション")
      out.push(mk(i++, t, "要点をつかんで人に伝えるのは得意ですか？"));
    else if (t === "包含")
      out.push(mk(i++, t, "輪から外れた人を自然に巻き込みにいきますか？"));
    else if (t === "ポジティブ")
      out.push(mk(i++, t, "場の空気を明るくする役割を自分で担うほうですか？"));
    else if (t === "分析思考")
      out.push(mk(i++, t, "まず根拠やデータから考えるほうですか？"));
    else if (t === "回復志向")
      out.push(mk(i++, t, "問題の原因を特定し直すのが得意ですか？"));
    else if (t === "規律性")
      out.push(mk(i++, t, "決めたルーチンを崩さずに続けられますか？"));
    else if (t === "目標志向")
      out.push(mk(i++, t, "ゴールから逆算して優先順位を切れるほうですか？"));
    else out.push(mk(i++, t, `「${t}」っぽさを自覚する瞬間は多いですか？`));
  }
  return out.length
    ? out
    : [
        {
          id: "SQ1",
          theme: "汎用",
          text: "最近、仕事で一番うまくいったことは何ですか？",
        },
      ];
}

export default async function seedQuestions(req: Request, res: Response) {
  try {
    const body = (req.body || {}) as {
      strengths_top5?: string[];
      demographics?: { ageRange?: string; gender?: string; hometown?: string };
      n?: number;
    };

    const strengths = sanitizeTop5(body.strengths_top5 || []);
    const demo = sanitizeDemo(body.demographics || {});
    const n = Math.max(1, Math.min(Number(body.n || 5), 10));

    // System / User プロンプト（Dify ワークフロー相当）
    const system =
      "あなたは1on1のための質問設計エージェントです。" +
      "入力の strengths_top5, demographics, n に基づき、" +
      '{ "questions": [ { "theme": "<資質名>", "text": "<日本語の質問文>" }, ... ] } ' +
      "というJSONを厳密に返してください。余計な前置きや説明文は書かないでください。\n" +
      "制約:\n" +
      "- 配列長は n 件\n" +
      "- text は具体的で、5〜40文字程度\n" +
      "- theme は strengths_top5 から選ぶ（不足する場合は最も関連の強い資質名を推定して入れる）\n" +
      "- 質問は YES/NO を想定した短い文にする（例: 「歴史の本が好きですか？」）";

    const user = `
ストレングス: ${JSON.stringify(strengths, null, 0)}
属性: ${JSON.stringify(demo, null, 0)}
個数: ${n}
出力は必ず JSON のみで返してください。`;

    let questions: { theme: string; text: string }[] = [];

    if (!process.env.OPENAI_API_KEY) {
      // キー未設定時はローカルフォールバック
      questions = localSeedQuestionsFromThemes(strengths).map(
        ({ id, ...r }) => r
      );
    } else {
      const resp = await client.chat.completions.create({
        model: MODEL,
        temperature: 0.4,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" }, // JSON強制
      });

      const content = resp.choices[0]?.message?.content || "{}";
      let obj: any = {};
      try {
        obj = JSON.parse(content);
      } catch {
        obj = {};
      }
      const raw = Array.isArray(obj?.questions) ? obj.questions : [];
      questions = raw
        .map((x: any) => ({
          theme: String(x?.theme || "汎用").trim(),
          text: String(x?.text || "").trim(),
        }))
        .filter((q: any) => q.text)
        .slice(0, n);

      if (!questions.length) {
        // フォールバック
        questions = localSeedQuestionsFromThemes(strengths).map(
          ({ id, ...r }) => r
        );
      }
    }

    // UI 期待の形式に id を付与
    const withId = questions.map((q, i) => ({ id: `SQ${i + 1}`, ...q }));
    res.json({ questions: withId });
  } catch (err: any) {
    console.error("[seed-questions] error", err);
    res.status(500).json({
      code: "LLM_ERROR",
      message: err?.message || "failed to generate seed questions",
    });
  }
}
