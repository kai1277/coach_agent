import { http, HttpResponse, delay } from "msw";
import { STRENGTH_THEMES } from "../../features/coach/constants/strengths";
import {
  QUESTIONS,
  STRENGTH2TYPE,
} from "../../features/coach/engine/constants";
import {
  priorFromContextAndTop5,
  pickNextQuestion,
  recomputePosterior,
  nextStepsByType,
  TYPE_LABEL,
  TYPES,
  type Question,
  normalize,
} from "../../features/coach/engine/inference";
import type { Answer5, TypeKey, SessionOutput } from "../../types/api";
import { createLLMClient } from "../../features/coach/llm/client";
import { buildStrengthProfile } from "../../features/coach/content/strengths_persona";

const { enabled: LLM_ENABLED, client: LLM } = createLLMClient();

const STRENGTH_SET = new Set<string>(STRENGTH_THEMES as readonly string[]);

// ---- テスト判定 ----
const env = (import.meta as any).env ?? {};
const IS_TEST = env.MODE === "test" || !!env.VITEST;

// ---- 軽微な demographics バイアス関数 ----
type Demo =
  | { ageRange?: string; gender?: string; hometown?: string }
  | undefined;

function biasWithDemographics(
  p: Record<TypeKey, number>,
  demographics: Demo
): Record<TypeKey, number> {
  if (!demographics) return p;
  let m = { ...p };
  const bump = (k: TypeKey, v: number) => (m[k] = (m[k] ?? 0) + v);

  if (demographics.gender) {
    bump("TYPE_EMPATHY", 0.03);
    bump("TYPE_STABILITY", 0.02);
  }
  if (demographics.ageRange) {
    const age = demographics.ageRange;
    if (/10|20/.test(age)) {
      bump("TYPE_STRATEGY", 0.04);
      bump("TYPE_EXECUTION", 0.03);
    } else if (/40|50|60|以上/.test(age)) {
      bump("TYPE_STABILITY", 0.04);
      bump("TYPE_ANALYTICAL", 0.02);
    } else {
      bump("TYPE_ANALYTICAL", 0.02);
    }
  }
  if (demographics.hometown) {
    if (/地方|ローカル/.test(demographics.hometown)) {
      bump("TYPE_STABILITY", 0.03);
    }
  }
  return normalize(m);
}

// ---- フォールバック用：ローカルで簡易生成 ----
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
  return out;
}

// ---- セッション状態 ----
type AnswerRec = {
  questionId: string;
  answer: Answer5;
  text: string;
  delta: number;
};
type Session = {
  id: string;
  createdAt: string;
  transcript: string;
  context?: string;
  strengths_top5?: string[];
  output: SessionOutput;
  loop: { threshold: number; maxQuestions: number; minQuestions: number };
  answers: AnswerRec[];
  askedCount: number;
  posterior: Record<TypeKey, number>;
  demographics?: { ageRange?: string; gender?: string; hometown?: string };
};

const SESSIONS = new Map<string, Session>();
let SEQ = 1;
const uid = () =>
  `sess_${(SEQ++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ---- posterior 再計算 ----
function recalc(sess: Session) {
  const prior0 = priorFromContextAndTop5(
    sess.context ?? null,
    sess.strengths_top5 ?? null,
    STRENGTH2TYPE
  );
  const prior = biasWithDemographics(prior0, sess.demographics);

  const qa = sess.answers
    .map((r) => {
      const q = QUESTIONS.find((x) => x.id === r.questionId);
      return q ? { q, a: r.answer } : null;
    })
    .filter((v): v is { q: Question; a: Answer5 } => !!v);
  const { posterior, deltas } = recomputePosterior(prior, qa);
  sess.posterior = posterior;
  qa.forEach((_, i) => {
    if (sess.answers[i]) sess.answers[i].delta = deltas[i] ?? 0;
  });
}

// ---- ルーティング ----
export const handlers = [
  // セッション作成
  http.post("*/api/sessions", async ({ request }) => {
    if (!IS_TEST) await delay(300 + Math.random() * 500);
    if (!IS_TEST && Math.random() < 0.1) {
      return HttpResponse.json(
        { code: "INTERNAL_ERROR", message: "Unexpected error" },
        { status: 500 }
      );
    }

    const body = (await request.json()) as {
      transcript?: string;
      context?: string;
      strengths_top5?: unknown;
      demographics?: { ageRange?: string; gender?: string; hometown?: string };
    };
    const transcript = (body.transcript ?? "").trim();
    if (transcript.length < 20) {
      return HttpResponse.json(
        {
          code: "VALIDATION_ERROR",
          message: "会話ログは20文字以上にしてください",
        },
        { status: 422 }
      );
    }

    // strengths_top5 検証
    let strengths: string[] | undefined = undefined;
    if (Array.isArray(body.strengths_top5)) {
      const raw = body.strengths_top5.map(String);
      if (raw.length > 5) {
        return HttpResponse.json(
          {
            code: "VALIDATION_ERROR",
            message: "ストレングスは最大5件までです",
          },
          { status: 422 }
        );
      }
      const uniq = Array.from(new Set(raw));
      if (uniq.length !== raw.length) {
        return HttpResponse.json(
          { code: "VALIDATION_ERROR", message: "ストレングスは重複不可です" },
          { status: 422 }
        );
      }
      const unknown = uniq.filter((s) => !STRENGTH_SET.has(s));
      if (unknown.length > 0) {
        return HttpResponse.json(
          {
            code: "VALIDATION_ERROR",
            message: `不正なストレングス: ${unknown.join(", ")}`,
          },
          { status: 422 }
        );
      }
      strengths = uniq;
    }

    const id = uid();
    const ctx = body.context ?? "仕事";
    const prior0 = priorFromContextAndTop5(
      ctx,
      strengths ?? null,
      STRENGTH2TYPE
    );
    const prior = biasWithDemographics(prior0, body.demographics);

    // persona は Top5 から一度だけ作る
    const persona =
      strengths && strengths.length > 0
        ? buildStrengthProfile(strengths)
        : undefined;

    const session: Session = {
      id,
      createdAt: new Date().toISOString(),
      transcript,
      context: ctx,
      strengths_top5: strengths,
      output: {
        summary: `【要約】${transcript.slice(0, 60)}…`,
        hypotheses: [],
        next_steps: [
          "次回定例の目的と期待アウトプットを明文化して共有",
          "判断基準（KPI/制約）を1枚で整理",
        ],
        citations: [],
        persona,
      },
      loop: { threshold: 0.9, maxQuestions: 8, minQuestions: 0 },
      answers: [],
      askedCount: 0,
      posterior: prior,
      demographics: body.demographics,
    };

    // LLM 有効なら出力を上書き（persona は維持）
    if (LLM_ENABLED) {
      try {
        const out = await LLM!.generateCoachOutput({
          transcript: session.transcript,
          context: session.context ?? null,
          strengths_top5: session.strengths_top5 ?? null,
          instruction: null,
        });
        session.output = {
          ...session.output,
          ...out,
          persona: session.output.persona,
        };
      } catch {
        /* noop */
      }
    }

    SESSIONS.set(id, session);
    return HttpResponse.json(
      {
        id: session.id,
        createdAt: session.createdAt,
        output: session.output,
        loop: session.loop,
      },
      { status: 201 }
    );
  }),

  // NEW: 質問生成（LLM→失敗時ローカル）
  http.post(
    "*/api/sessions/:id/seed-questions",
    async ({ params, request }) => {
      if (!IS_TEST) await delay(200 + Math.random() * 300);
      const sess = SESSIONS.get(String(params.id));
      if (!sess) {
        return HttpResponse.json(
          { code: "NOT_FOUND", message: "session not found" },
          { status: 404 }
        );
      }
      const body = (await request.json()) as {
        strengths_top5?: string[];
        demographics?: {
          ageRange?: string;
          gender?: string;
          hometown?: string;
        };
        n?: number;
      };

      // LLM 優先、失敗ならフォールバック
      if (LLM_ENABLED && LLM?.generateSeedQuestions) {
        try {
          const { questions } = await LLM.generateSeedQuestions({
            strengths_top5: body.strengths_top5 ?? sess.strengths_top5 ?? [],
            demographics: body.demographics ?? sess.demographics ?? {},
            n: body.n ?? 5,
          });
          // id付与
          const withId = questions.map((q, i) => ({
            id: `SQ${i + 1}`,
            theme: q.theme,
            text: q.text,
          }));
          return HttpResponse.json({ questions: withId });
        } catch (e: any) {
          // フォールバック
        }
      }
      const baseThemes = (body.strengths_top5 ?? sess.strengths_top5 ?? []).map(
        String
      );
      const local = localSeedQuestionsFromThemes(baseThemes);
      return HttpResponse.json({ questions: local });
    }
  ),

  // セッション取得
  http.get("*/api/sessions/:id", async ({ params }) => {
    if (!IS_TEST) await delay(150 + Math.random() * 200);
    const sess = SESSIONS.get(String(params.id));
    if (!sess)
      return HttpResponse.json(
        { code: "NOT_FOUND", message: "session not found" },
        { status: 404 }
      );
    return HttpResponse.json({
      id: sess.id,
      createdAt: sess.createdAt,
      output: sess.output,
      loop: sess.loop,
    });
  }),

  // 追加アクション
  http.post("*/api/sessions/:id/actions", async ({ params, request }) => {
    if (!IS_TEST) await delay(200 + Math.random() * 300);
    const sess = SESSIONS.get(String(params.id));
    if (!sess)
      return HttpResponse.json(
        { code: "NOT_FOUND", message: "session not found" },
        { status: 404 }
      );

    const { instruction } = (await request.json()) as { instruction?: string };
    const ins = (instruction ?? "").trim();

    if (LLM_ENABLED && ins.length > 0) {
      try {
        const out = await LLM!.generateCoachOutput({
          transcript: sess.transcript,
          context: sess.context ?? null,
          strengths_top5: sess.strengths_top5 ?? null,
          instruction: ins,
        });
        sess.output = { ...sess.output, ...out };
        if (sess.strengths_top5?.length) {
          sess.output.persona = buildStrengthProfile(sess.strengths_top5);
        }
      } catch {
        if (ins) {
          sess.output.summary =
            `【更新】${ins}\n\n` + (sess.output.summary || "");
          sess.output.next_steps = [
            `指示反映：${ins} に沿ってまず1歩動く`,
            ...sess.output.next_steps.slice(0, 2),
          ];
        }
      }
      return HttpResponse.json({
        id: sess.id,
        createdAt: sess.createdAt,
        output: sess.output,
      });
    }

    if (ins) {
      sess.output.summary = `【更新】${ins}\n\n` + (sess.output.summary || "");
      sess.output.next_steps = [
        `指示反映：${ins} に沿ってまず1歩動く`,
        ...sess.output.next_steps.slice(0, 2),
      ];
    }
    return HttpResponse.json({
      id: sess.id,
      createdAt: sess.createdAt,
      output: sess.output,
    });
  }),

  // 診断ループ設定の更新
  http.patch("*/api/sessions/:id/loop", async ({ params, request }) => {
    if (!IS_TEST) await delay(80 + Math.random() * 120);
    const sess = SESSIONS.get(String(params.id));
    if (!sess)
      return HttpResponse.json(
        { code: "NOT_FOUND", message: "session not found" },
        { status: 404 }
      );

    const body = (await request.json()) as {
      threshold?: number;
      maxQuestions?: number;
      minQuestions?: number;
    };
    if (typeof body.threshold === "number") {
      const th = body.threshold;
      if (th < 0.5 || th >= 1)
        return HttpResponse.json(
          { code: "VALIDATION_ERROR", message: "thresholdは0.5〜0.99" },
          { status: 422 }
        );
      sess.loop.threshold = th;
    }
    if (typeof body.maxQuestions === "number") {
      const mq = body.maxQuestions;
      if (mq < 2 || mq > 12)
        return HttpResponse.json(
          { code: "VALIDATION_ERROR", message: "maxQuestionsは2〜12" },
          { status: 422 }
        );
      sess.loop.maxQuestions = mq;
    }
    if (typeof body.minQuestions === "number") {
      const mn = body.minQuestions;
      if (mn < 0 || mn > 10)
        return HttpResponse.json(
          { code: "VALIDATION_ERROR", message: "minQuestionsは0〜10" },
          { status: 422 }
        );
      if (mn > sess.loop.maxQuestions)
        return HttpResponse.json(
          {
            code: "VALIDATION_ERROR",
            message: "minQuestionsはmaxQuestions以下",
          },
          { status: 422 }
        );
      sess.loop.minQuestions = mn;
    }
    return HttpResponse.json({ ok: true, loop: sess.loop });
  }),

  // 次の質問
  http.get("*/api/sessions/:id/questions/next", async ({ params }) => {
    if (!IS_TEST) await delay(50 + Math.random() * 100);
    const sess = SESSIONS.get(String(params.id));
    if (!sess)
      return HttpResponse.json(
        { code: "NOT_FOUND", message: "session not found" },
        { status: 404 }
      );

    const post = sess.posterior;
    const top = TYPES.reduce((a, b) => (post[a] >= post[b] ? a : b));

    if (sess.askedCount === 0) {
      const answeredIds = new Set<string>();
      const { question } = pickNextQuestion(
        sess.posterior,
        QUESTIONS,
        answeredIds
      );
      const q = question ?? QUESTIONS[0];
      return HttpResponse.json({
        done: false,
        question: { id: q.id, text: q.text },
        progress: { asked: sess.askedCount, max: sess.loop.maxQuestions },
        hint: { topLabel: TYPE_LABEL[top], confidence: post[top] },
        posterior: post,
      });
    }

    const canStop =
      sess.askedCount >= (sess.loop.minQuestions ?? 0) &&
      (post[top] >= sess.loop.threshold ||
        sess.askedCount >= sess.loop.maxQuestions);
    if (canStop) {
      const steps = nextStepsByType(top);
      const evidence = [...sess.answers]
        .sort((a, b) => b.delta - a.delta)
        .slice(0, 5)
        .map((e) => ({
          questionId: e.questionId,
          text: e.text,
          answer: e.answer,
          delta: e.delta,
        }));

      return HttpResponse.json({
        done: true,
        top: { id: top, label: TYPE_LABEL[top], confidence: post[top] },
        next_steps: steps,
        asked: sess.askedCount,
        max: sess.loop.maxQuestions,
        posterior: post,
        evidence,
      });
    }

    const answeredIds = new Set<string>(sess.answers.map((a) => a.questionId));
    const picked = pickNextQuestion(sess.posterior, QUESTIONS, answeredIds);
    const question = picked.question ?? QUESTIONS[0];
    return HttpResponse.json({
      done: false,
      question: { id: question.id, text: question.text },
      progress: { asked: sess.askedCount, max: sess.loop.maxQuestions },
      hint: { topLabel: TYPE_LABEL[top], confidence: post[top] },
      posterior: post,
    });
  }),

  // 回答
  http.post("*/api/sessions/:id/answers", async ({ params, request }) => {
    if (!IS_TEST) await delay(50 + Math.random() * 120);
    const sess = SESSIONS.get(String(params.id));
    if (!sess)
      return HttpResponse.json(
        { code: "NOT_FOUND", message: "session not found" },
        { status: 404 }
      );

    const body = (await request.json()) as {
      questionId?: string;
      answer?: Answer5;
    };
    const qid = String(body.questionId || "");
    const ans = body.answer as Answer5;
    const q = QUESTIONS.find((x) => x.id === qid);
    if (!qid || !q)
      return HttpResponse.json(
        { code: "VALIDATION_ERROR", message: "questionIdが不正です" },
        { status: 422 }
      );

    const isAnswer5 = (x: any): x is Answer5 =>
      x === "YES" ||
      x === "PROB_YES" ||
      x === "UNKNOWN" ||
      x === "PROB_NO" ||
      x === "NO";
    if (!isAnswer5(ans)) {
      return HttpResponse.json(
        { code: "VALIDATION_ERROR", message: "answerが不正です" },
        { status: 422 }
      );
    }

    sess.answers.push({ questionId: qid, answer: ans, text: q.text, delta: 0 });
    sess.askedCount = sess.answers.length;

    recalc(sess);

    const post = sess.posterior;
    const top = TYPES.reduce((a, b) => (post[a] >= post[b] ? a : b));
    const mustAskMore = sess.askedCount < Math.max(1, sess.loop.minQuestions);
    const hitThreshold = post[top] >= sess.loop.threshold;
    const hitMax = sess.askedCount >= sess.loop.maxQuestions;
    if (!mustAskMore && (hitThreshold || hitMax)) {
      const steps = nextStepsByType(top);
      const evidence = [...sess.answers]
        .sort((a, b) => b.delta - a.delta)
        .slice(0, 5);
      return HttpResponse.json({
        done: true,
        top: { id: top, label: TYPE_LABEL[top], confidence: post[top] },
        next_steps: steps,
        asked: sess.askedCount,
        max: sess.loop.maxQuestions,
        posterior: post,
        evidence,
      });
    }

    const answeredIds = new Set<string>(sess.answers.map((a) => a.questionId));
    const { question } = pickNextQuestion(
      sess.posterior,
      QUESTIONS,
      answeredIds
    );
    return HttpResponse.json({
      done: false,
      question: question ? { id: question.id, text: question.text } : null,
      progress: { asked: sess.askedCount, max: sess.loop.maxQuestions },
      hint: { topLabel: TYPE_LABEL[top], confidence: post[top] },
      posterior: post,
    });
  }),

  // 取り消し
  http.post("*/api/sessions/:id/answers/undo", async ({ params }) => {
    if (!IS_TEST) await delay(30 + Math.random() * 60);
    const sess = SESSIONS.get(String(params.id));
    if (!sess)
      return HttpResponse.json(
        { code: "NOT_FOUND", message: "session not found" },
        { status: 404 }
      );
    if (sess.answers.length === 0) {
      return HttpResponse.json(
        { code: "INVALID", message: "取り消す回答がありません" },
        { status: 422 }
      );
    }
    sess.answers.pop();
    sess.askedCount = sess.answers.length;

    recalc(sess);

    const answeredIds = new Set<string>(sess.answers.map((a) => a.questionId));
    const { question } = pickNextQuestion(
      sess.posterior,
      QUESTIONS,
      answeredIds
    );
    const post = sess.posterior;
    const top = TYPES.reduce((a, b) => (post[a] >= post[b] ? a : b));
    return HttpResponse.json({
      done: false,
      question: question ? { id: question.id, text: question.text } : null,
      progress: { asked: sess.askedCount, max: sess.loop.maxQuestions },
      hint: { topLabel: TYPE_LABEL[top], confidence: post[top] },
      posterior: post,
    });
  }),
];
